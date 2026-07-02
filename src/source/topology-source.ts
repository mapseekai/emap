import { EventDispatcher } from '../core/events';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';
import { unzip, strFromU8, zipSync } from 'fflate';
import type { UnzipFileInfo, Unzipped } from 'fflate';
import { DisplayArcs } from './display-arcs';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { ExportFormat, ExportOptions, GetArrowTableOptions } from './source';
import { getDefaultMapshaperRunner, type MapshaperRunner } from './mapshaper-runner';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import {
  normalizeProjectCrsMetadata,
  resolveDatasetCRS,
  resolveDatasetCRSMetadata,
  resolveProjectCrs,
  setDatasetCrsMetadata,
} from '../geo/crs-resolver';
import {
  getExportHandler,
  getFileExtension,
  getFormatForExtension,
  getTableConverter,
  isKnownPluginExtension,
  type ImportedBinaryDataset,
} from './format-registry';

export type TopologySourceData = string | { filename: string; content: Uint8Array };

/**
 * Formats whose specs fix the CRS to WGS84 lon/lat: GeoJSON / TopoJSON
 * (RFC 7946) and KML (OGC). Imports of these formats get an explicit
 * `EPSG:4326` when the dataset carries no other CRS metadata, so display
 * and export don't have to treat the CRS as unknown.
 */
const WGS84_SPEC_FORMAT_RE = /\.(geojson|topojson|json|kml)$/i;

/**
 * Input shapes accepted by {@link TopologySource.setData}:
 * - URL string,
 * - single `{filename, content}` object,
 * - or an array of `{filename, content}` for multi-file imports (each file
 *   becomes its own layer in a single dataset; matches mapshaper's
 *   `-i FILE1 FILE2 ...` CLI behaviour).
 */
export type TopologySourceInput =
  | TopologySourceData
  | Array<{ filename: string; content: Uint8Array }>;

/** MIME type for each supported export format */
const EXPORT_MIME: Record<ExportFormat, string> = {
  geojson: 'application/geo+json',
  topojson: 'application/json',
  shapefile: 'application/zip',
  msx: 'application/octet-stream',
  geoparquet: 'application/vnd.apache.parquet',
  geoarrow: 'application/vnd.apache.arrow.file',
};

/** Coerce mapshaper export content (string | Uint8Array | ArrayBuffer) to Uint8Array for zip packing. */
function toUint8Array(content: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  return new Uint8Array(content);
}

/**
 * Coerce mapshaper export content to a Blob-compatible part.
 *
 * Strings, ArrayBuffers, and Uint8Arrays are all valid `BlobPart` values at
 * runtime, but TS strict mode rejects `Uint8Array<ArrayBufferLike>` as
 * `BlobPart` (which expects `ArrayBuffer`). Since mapshaper always produces
 * regular non-shared buffers, the cast is safe.
 */
function toBlobPart(content: string | Uint8Array | ArrayBuffer): BlobPart {
  return content as BlobPart;
}

/**
 * Resource ceilings applied by {@link TopologySource} when extracting a ZIP
 * payload. Defaults are intentionally generous so legitimate shapefile zips
 * keep working unchanged. Apps that load adversarial / public-internet zips
 * should lower them.
 */
export interface ZipExtractionLimits {
  /** Max summed uncompressed size of all kept entries, in bytes. Default 200 MB. */
  maxBytes?: number;
  /** Max entry count fflate may yield. Default 5000. */
  maxEntries?: number;
  /** Max `uncompressedTotal / compressedInput` ratio. Default 100. */
  maxRatio?: number;
}

const DEFAULT_ZIP_LIMITS: Required<ZipExtractionLimits> = {
  maxBytes: 200 * 1024 * 1024,
  maxEntries: 5000,
  maxRatio: 100,
};

export interface TopologySourceOptions {
  data?: TopologySourceInput;
  zipLimits?: ZipExtractionLimits;
  /**
   * Optional injection point for the mapshaper command runner used by
   * the load path. Defaults to a process-wide singleton that calls
   * `MapshaperAdapter.runImport / runOnDataset` directly.
   * Tests and instrumentation use this to swap in a mock runner.
   */
  mapshaperRunner?: MapshaperRunner;
}

export interface TopologySourceFromBytesOptions extends Omit<TopologySourceOptions, 'data'> {
  /**
   * Filename handed to mapshaper's importer. The extension is significant:
   * use `.geojson`, `.topojson`, `.json`, `.zip`, `.shp`, `.kml`, or `.msx`
   * so mapshaper can choose the right parser.
   */
  filename?: string;
}

export class TopologySource extends EventDispatcher implements ITopologySource {
  public id: string;
  public type: 'topology' = 'topology';
  private _dataset: MapshaperDataset | undefined;
  private _displayArcs: DisplayArcs | null = null;
  private _options: TopologySourceOptions;
  private _data: TopologySourceInput | undefined;
  private _loadVersion: number = 0;
  private _abortController: AbortController | null = null;
  /**
   * Deferred backing the {@link setData} promise. Settled by the matching
   * `_loadVersion`'s `_updateData` run (resolve on `data`, reject on `error`).
   * A superseding `setData` resolves it early — last-write-wins, the newer
   * call owns the next outcome.
   */
  private _pending: {
    version: number;
    resolve: (s: TopologySource) => void;
    reject: (e: unknown) => void;
  } | null = null;
  /**
   * Sticky simplification floor. mapshaper's `-simplify` writes a
   * `retainedInterval` into the resulting `ArcCollection`; we cache that
   * value here so the render loop's per-frame zoom-LOD doesn't stomp it.
   * Re-captured on every `setDataset` / `setData`.
   */
  private _simplifyFloor: number = 0;
  private _runner: MapshaperRunner;
  private _renderRevision = 0;
  private _dataRevision = 0;

  /** Max-detail threshold the user (or last `-simplify` run) asked for. */
  getSimplifyFloor(): number {
    return this._simplifyFloor;
  }

  getRenderRevision(): number {
    return this._renderRevision;
  }

  private _bumpRenderRevision(): void {
    this._renderRevision++;
  }

  /**
   * Monotonic counter of committed data changes (edits, dataset replaces,
   * reprojection). Derived caches (Arrow tables, render chunks) compare
   * their stamp against this to detect staleness. Render-only churn
   * (markDisplayArcsDirty / refreshDisplayArcs) does NOT bump it.
   */
  public getDataRevision(): number {
    return this._dataRevision;
  }

  /**
   * Record an in-place data edit (vertex move, undo/redo, …). O(1) — no
   * rebuild happens here; stale caches rebuild lazily on next access.
   */
  public markDataEdited(): void {
    this._dataRevision++;
  }

  /** Derived Arrow tables keyed by `layer|encoding`, stamped with the data
   * revision they were built from. Bounded: at most layers × 2 entries. */
  private _arrowCache = new Map<string, { table: unknown; revision: number }>();

  private _arrowCacheKey(layer: number | string | undefined, encoding: string): string {
    return `${layer ?? 0}|${encoding}`;
  }

  /**
   * GeoArrow table for one layer of the current dataset. Cached per
   * (layer, encoding); rebuilt lazily when the data revision moved.
   * Returns `unknown` because the core bundle must not name apache-arrow
   * types — callers in formats/duckdb code cast to `Table`.
   */
  public getArrowTable(opts: GetArrowTableOptions = {}): unknown {
    if (!this._dataset) {
      throw new Error('TopologySource has no dataset');
    }
    const encoding = opts.encoding ?? 'native';
    const key = this._arrowCacheKey(opts.layer, encoding);
    const hit = this._arrowCache.get(key);
    if (hit && hit.revision === this._dataRevision) return hit.table;

    const converter = getTableConverter();
    if (!converter) {
      throw new Error(
        "Arrow table support requires the formats module: import '@zwishing/emap/formats' first",
      );
    }

    // Same interval discipline as export(): the render loop may have set a
    // simplification interval on the live arcs; derived tables must always
    // carry full-detail coordinates.
    const arcs = this._dataset.arcs;
    const savedInterval = arcs?.getRetainedInterval?.() ?? 0;
    if (savedInterval && arcs?.setRetainedInterval) arcs.setRetainedInterval(0);
    try {
      const table = converter.toTable(this._dataset, { layer: opts.layer, encoding });
      this._arrowCache.set(key, { table, revision: this._dataRevision });
      return table;
    } finally {
      if (savedInterval && arcs?.setRetainedInterval) arcs.setRetainedInterval(savedInterval);
    }
  }

  /**
   * Install an externally produced table as the cache entry for the CURRENT
   * data revision — the import path (revision 0) and DuckDB result tables
   * use this so unedited data never pays a conversion. Call AFTER any
   * setDataset/revision bump for the data the table describes.
   */
  public seedArrowTable(
    table: unknown,
    opts: { encoding: 'native' | 'wkb'; layer?: number | string },
  ): void {
    this._arrowCache.set(this._arrowCacheKey(opts.layer, opts.encoding), {
      table,
      revision: this._dataRevision,
    });
  }

  constructor(id: string, options?: TopologySourceOptions) {
    super();
    this.id = id;
    this._options = options || {};
    this._data = this._options.data;
    this._runner = this._options.mapshaperRunner ?? getDefaultMapshaperRunner();

    if (this._data) {
      this._updateData();
    }
  }

  /**
   * Convenience loader for URL-backed sources.
   *
   * Resolves after the first successful `data` event and rejects on the first
   * load `error`, so callers can safely add the returned source to a map.
   */
  static async fromUrl(
    id: string,
    url: string,
    options?: Omit<TopologySourceOptions, 'data'>,
  ): Promise<TopologySource> {
    const source = new TopologySource(id, options);
    await source.setData(url);
    return source;
  }

  /**
   * Convenience loader for in-memory bytes, e.g. files selected through an
   * `<input type="file">`. Resolves after the import succeeds and rejects on
   * the first load error.
   */
  static async fromBytes(
    id: string,
    bytes: Uint8Array | ArrayBuffer,
    options?: TopologySourceFromBytesOptions,
  ): Promise<TopologySource> {
    const { filename = `${id}.geojson`, ...sourceOptions } = options ?? {};
    const content = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const source = new TopologySource(id, sourceOptions);
    await source.setData({ filename, content });
    return source;
  }

  /**
   * Replace the source's data and trigger a re-import.
   *
   * Accepts a URL, a single `{filename, content}` object, or an array of
   * `{filename, content}` for multi-file imports (each file becomes its own
   * layer in one dataset — same behaviour as mapshaper's
   * `-i FILE1 FILE2 ...` CLI invocation).
   *
   * Returns a promise that resolves with the source once the import
   * completes and rejects if it fails — `await source.setData(...)` is the
   * canonical way to wait for the dataset. The `data` / `error` events still
   * fire for event-driven consumers.
   *
   * Last-write-wins: rapid back-to-back calls supersede each other. Only the
   * latest call's outcome fires `data` / `error`; in-flight URL fetches from
   * superseded calls are aborted. A superseded call's promise resolves early
   * (the newer call owns the next outcome) so awaiting it never hangs.
   */
  setData(data: TopologySourceInput): Promise<TopologySource> {
    this._loadVersion++;
    const version = this._loadVersion;
    this._abortController?.abort();
    this._abortController = null;
    this._data = data;

    // A newer call supersedes any in-flight one: settle it now so awaiters
    // don't hang on a chain that will never fire its own data/error.
    this._pending?.resolve(this);

    const promise = new Promise<TopologySource>((resolve, reject) => {
      this._pending = { version, resolve, reject };
    });
    // Legacy fire-and-forget callers never consume this promise; a no-op
    // handler keeps an import failure from surfacing as an unhandled
    // rejection. Explicit `await`ers still observe the rejection via their
    // own handler.
    promise.catch(() => {});

    void this._updateData();
    return promise;
  }

  private async _updateData(): Promise<void> {
    if (!this._data) return;

    const version = this._loadVersion;
    const controller = new AbortController();
    this._abortController = controller;

    this.fire('dataloading');

    try {
      // Normalize every input shape (URL / single file / array) to the same
      // resolved structure: an inputFiles dictionary plus the list of primary
      // file names that mapshaper's `-i` should reference.
      const inputFiles: Record<string, Uint8Array | string> = {};
      const primaryFiles: string[] = [];

      if (Array.isArray(this._data)) {
        // Multi-file import: each entry becomes its own layer in one dataset
        // (same behaviour as mapshaper CLI `-i FILE1 FILE2 ...`).
        if (this._data.length === 0) {
          throw new Error('setData received an empty array; nothing to import');
        }
        for (const entry of this._data) {
          if (this._isZipFile(entry.filename)) {
            const extracted = await this._extractZip(entry.content);
            const primary = this._findPrimaryFile(extracted);
            if (!primary) {
              throw new Error(`No importable file found in zip archive: ${entry.filename}`);
            }
            for (const [name, content] of Object.entries(extracted)) {
              inputFiles[name] = content;
            }
            primaryFiles.push(primary);
          } else {
            inputFiles[entry.filename] = entry.content;
            primaryFiles.push(entry.filename);
          }
        }
      } else {
        let input: { filename: string; content: Uint8Array };
        if (typeof this._data === 'string') {
          // Load from URL
          const url = this._data;
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
          }

          const buf = await response.arrayBuffer();
          const content = new Uint8Array(buf);

          const urlPath = this._pathnameFromUrl(url);
          let filename = urlPath.split('/').pop() || '';

          if (!this._hasSupportedExtension(filename)) {
            const contentType = response.headers.get('Content-Type') || '';
            filename = this._filenameFromContentType(contentType, filename);
          }

          if (!filename) {
            filename = 'data.json';
          }

          input = { filename, content };
        } else {
          input = this._data;
        }

        if (this._isZipFile(input.filename)) {
          const extracted = await this._extractZip(input.content);
          const primary = this._findPrimaryFile(extracted);
          if (!primary) {
            throw new Error('No importable file found in zip archive');
          }
          for (const [name, content] of Object.entries(extracted)) {
            inputFiles[name] = content;
          }
          primaryFiles.push(primary);
        } else {
          inputFiles[input.filename] = input.content;
          primaryFiles.push(input.filename);
        }
      }

      // Plugin formats (GeoParquet / GeoArrow) bypass mapshaper's CLI —
      // mapshaper has no parser for them. The plugin builds the dataset
      // directly (including cleanPathsAfterImport + buildTopology).
      const pluginImport = this._resolvePluginImport(primaryFiles, inputFiles);

      // Match mapshaper GUI's import path: bare `-i FILE [FILE2 ...]`.
      // mapshaper's importContent runs cleanPathsAfterImport (deduplication
      // + defective-path removal) and buildTopology (coincident-endpoint
      // sharing required by topology-aware vertex editing), both cheap.
      // We deliberately do NOT run `-clean` or `-simplify 100%` here — both
      // are O(N²) / O(N log N) and make interactive imports of moderate-
      // sized files unusable. Callers run `Emap.ops.cleanLayer()` /
      // `source.simplifyArcs()` explicitly when they need those passes.
      const cmd = `-i ${primaryFiles.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(' ')}`;
      const imported = pluginImport ? await pluginImport : null;
      const rich =
        imported && typeof imported === 'object' && 'dataset' in imported
          ? (imported as ImportedBinaryDataset)
          : null;
      const dataset: MapshaperDataset = pluginImport
        ? rich
          ? rich.dataset
          : (imported as MapshaperDataset)
        : await this._runner.runImport(cmd, inputFiles);

      if (
        resolveDatasetCRSMetadata(dataset) === undefined &&
        primaryFiles.every((f) => WGS84_SPEC_FORMAT_RE.test(f))
      ) {
        dataset.info ??= {};
        dataset.info.crs_string = 'EPSG:4326';
      }

      // Stale guard: another setData superseded this run while it was awaiting.
      // Drop the result silently — the live chain owns the next data/error.
      if (version !== this._loadVersion) return;

      this._dataset = dataset;
      // Initialize LOD wrapper for large datasets
      if (this._dataset?.arcs) {
        this._displayArcs = new DisplayArcs(this._dataset.arcs);
      }
      this._simplifyFloor = this._dataset?.arcs?.getRetainedInterval?.() ?? 0;
      this._bumpRenderRevision();
      this._dataRevision++;

      // Seed the revision-0 Arrow cache with the table the plugin already
      // parsed — a single-file GeoArrow/GeoParquet load then pays zero
      // conversion on first DuckDB/export use. Must run after the revision
      // bump above so the cache entry isn't stamped stale on arrival.
      if (rich?.arrowTable) {
        this.seedArrowTable(rich.arrowTable, { encoding: rich.arrowEncoding ?? 'native' });
      }

      this.fire('data', { reason: 'load' });
      this._resolvePending(version);
    } catch (err: any) {
      // Stale chain (either superseded by a newer setData, or its fetch was
      // aborted by us). Either way, the new chain owns the next event.
      if (version !== this._loadVersion) return;
      if (err?.name === 'AbortError') return;
      this.fire('error', { error: err });
      this._rejectPending(version, err ?? new Error('setData import failed'));
    }
  }

  /**
   * Resolve the {@link setData} deferred for the given load version. Ignored
   * if a newer call has already replaced it (the superseding `setData`
   * resolved the old deferred early).
   */
  private _resolvePending(version: number): void {
    if (this._pending?.version !== version) return;
    const pending = this._pending;
    this._pending = null;
    pending.resolve(this);
  }

  /**
   * Reject the {@link setData} deferred for the given load version. Ignored
   * if a newer call has already replaced it.
   */
  private _rejectPending(version: number, error: unknown): void {
    if (this._pending?.version !== version) return;
    const pending = this._pending;
    this._pending = null;
    pending.reject(error);
  }

  /**
   * Route plugin-format files (GeoParquet / GeoArrow) to their registered
   * {@link DatasetFormatPlugin}. Returns `null` when no file involves a
   * plugin extension (caller proceeds with mapshaper's `-i` import).
   *
   * v1 restriction: a plugin file must be the only input — mapshaper's
   * multi-file `-i` can't mix datasets it can't parse.
   */
  private _resolvePluginImport(
    primaryFiles: string[],
    inputFiles: Record<string, Uint8Array | string>,
  ): Promise<MapshaperDataset | ImportedBinaryDataset> | null {
    const pluginFile = primaryFiles.find((f) => isKnownPluginExtension(getFileExtension(f)));
    if (!pluginFile) return null;
    const ext = getFileExtension(pluginFile);
    const plugin = getFormatForExtension(ext);
    if (!plugin) {
      throw new Error(
        `'.${ext}' import requires the emap formats module — ` +
          `import '@zwishing/emap/formats' (or call registerFormat) before setData`,
      );
    }
    if (primaryFiles.length > 1) {
      throw new Error(`'.${ext}' files cannot be combined with other files in one import`);
    }
    const content = inputFiles[pluginFile];
    if (typeof content === 'string') {
      throw new Error(`'.${ext}' import expects binary content, received a string`);
    }
    return plugin.importBinary(content, pluginFile);
  }

  private _hasSupportedExtension(filename: string): boolean {
    return /\.(json|geojson|topojson|zip|shp|kml|msx|parquet|geoparquet|arrow|arrows|feather)$/i.test(
      filename,
    );
  }

  private _filenameFromContentType(contentType: string, fallbackName: string): string {
    const ct = contentType.toLowerCase().split(';')[0].trim();
    const extMap: Record<string, string> = {
      'application/json': '.json',
      'application/geo+json': '.geojson',
      'application/vnd.geo+json': '.geojson',
      'application/topojson+json': '.topojson',
      'application/zip': '.zip',
      'application/x-zip-compressed': '.zip',
      'application/octet-stream': '.zip',
      'application/vnd.google-earth.kml+xml': '.kml',
      'application/vnd.apache.parquet': '.parquet',
      'application/vnd.apache.arrow.file': '.arrow',
      'application/vnd.apache.arrow.stream': '.arrows',
      'text/plain': '.json',
    };
    const ext = extMap[ct] || '.json';
    return (fallbackName || 'data') + ext;
  }

  private _pathnameFromUrl(url: string): string {
    try {
      const base =
        typeof window !== 'undefined' && window.location?.href
          ? window.location.href
          : 'http://emap.local/';
      return new URL(url, base).pathname;
    } catch {
      return url.split(/[?#]/, 1)[0];
    }
  }

  public getDataset(): MapshaperDataset | undefined {
    return this._dataset;
  }

  /**
   * Canonical CRS identifier for the loaded dataset (`EPSG:NNNN` or a
   * passthrough label). Heuristics live in {@link resolveDatasetCRS} so the
   * resolution can be unit-tested independently of TopologySource.
   */
  public getCRS(): string {
    return resolveDatasetCRS(this._dataset);
  }

  public async reproject(targetCrs: string, targetCrsMetadata?: string): Promise<void> {
    if (!this._dataset) return;
    const resolvedTargetCrs = await resolveProjectCrs(targetCrs);
    const metadataCrs = targetCrsMetadata ?? normalizeProjectCrsMetadata(targetCrs);

    // Reset dynamic simplification before running -proj. Mapshaper's -proj
    // internally calls arcs.flatten(), which errors if an interval is set but
    // simplification thresholds are missing.
    if (this._dataset?.arcs?.setRetainedInterval) {
      this._dataset.arcs.setRetainedInterval(0);
    }

    // Drop stale CRS identifiers BEFORE projection. Mapshaper's -proj only
    // updates dataset.info.crs; it leaves crs_string / prj / wkt1 untouched, so
    // without this reset getCRS() would keep returning the source CRS.
    if (this._dataset.info) {
      delete this._dataset.info.crs_string;
      delete this._dataset.info.prj;
      delete this._dataset.info.wkt1;
    }

    const cmd = `-proj ${resolvedTargetCrs}`;

    const result = await getDefaultMapshaperAdapter().runOnDataset(cmd, this._dataset);
    setDatasetCrsMetadata(result, metadataCrs);
    this._dataset = result;
    // Re-initialize DisplayArcs (including LOD threshold detection) against
    // the post-projection arcs — coordinates and z-values may have changed.
    if (this._dataset?.arcs) {
      this._displayArcs = new DisplayArcs(this._dataset.arcs);
    }
    this._bumpRenderRevision();
    this._dataRevision++;
  }

  getExtent(): Bounds {
    if (!this._dataset) return new Bounds();
    const info = getDefaultMapshaperAdapter().getDatasetBounds(this._dataset);
    return new Bounds(info.xmin, info.ymin, info.xmax, info.ymax);
  }

  getArcs(): any {
    return this._dataset?.arcs;
  }

  /**
   * Returns the DisplayArcs wrapper for LOD support.
   * Use getScaledArcs(unitsPerPixel) to get the appropriate LOD.
   */
  getDisplayArcs(): DisplayArcs | null {
    return this._displayArcs;
  }

  /**
   * Mark the cached LOD copy stale; the next `getScaledArcs()` call inside
   * the renderer will rebuild it lazily. Cheap (O(1)) so per-frame edit
   * sessions can call this on every step without paying the rebuild cost
   * until the user actually zooms out far enough to need the filtered copy.
   */
  markDisplayArcsDirty(): void {
    this._displayArcs?.markDirty();
    this._bumpRenderRevision();
  }

  /**
   * Eagerly re-initialize DisplayArcs from the current dataset arcs. Use
   * for one-shot mutations where the caller wants the new LOD copy ready
   * immediately (project, dataset-replace). Per-frame in-place edits
   * should prefer {@link markDisplayArcsDirty}.
   */
  refreshDisplayArcs(): void {
    if (this._dataset?.arcs) {
      this._displayArcs = new DisplayArcs(this._dataset.arcs);
    }
    this._bumpRenderRevision();
  }

  /**
   * Swap the active dataset. Used by dataset-replace commands (clip / erase /
   * dissolve / …) and by reproject. Rebuilds the LOD copy and notifies
   * listeners with the `data` event.
   */
  public setDataset(dataset: MapshaperDataset): void {
    this._dataset = dataset;
    if (dataset.arcs) {
      this._displayArcs = new DisplayArcs(dataset.arcs);
    } else {
      this._displayArcs = null;
    }
    // Re-capture the simplification floor: mapshaper's `-simplify` writes
    // a non-zero `retainedInterval` here; other ops typically leave it at 0.
    this._simplifyFloor = dataset.arcs?.getRetainedInterval?.() ?? 0;
    this._bumpRenderRevision();
    this._dataRevision++;
    // `replace` distinguishes edit-driven dataset swaps from initial `load` —
    // listeners that auto-fit the viewport should only react to `load`.
    this.fire('data', { reason: 'replace' });
  }

  /**
   * Serialize the current dataset to a browser Blob via mapshaper's exporter.
   *
   * Multi-file shapefile output is packed into a single zip Blob using fflate
   * so callers always receive one Blob per call.
   */
  public async export(options: ExportOptions): Promise<Blob> {
    if (!this._dataset) {
      throw new Error('TopologySource has no dataset to export');
    }

    // mapshaper's exporters materialize the simplified copy when an interval is
    // set. emap uses simplification only for render LOD, so reset the interval
    // for the duration of the export and restore it afterwards.
    const arcs = this._dataset.arcs;
    const savedInterval = arcs?.getRetainedInterval?.() ?? 0;
    if (savedInterval && arcs?.setRetainedInterval) {
      arcs.setRetainedInterval(0);
    }

    try {
      // Plugin formats (geoparquet / geoarrow) are produced by their
      // registered DatasetFormatPlugin, not by mapshaper's exporters.
      const pluginHandler = getExportHandler(options.format);
      if (pluginHandler) {
        const files = await pluginHandler(this._dataset, options);
        return this._filesToBlob(files, options.format);
      }
      if (options.format === 'geoparquet' || options.format === 'geoarrow') {
        throw new Error(
          `'${options.format}' export requires the emap formats module — ` +
            `import '@zwishing/emap/formats' (or call registerFormat) before export`,
        );
      }
      // mapshaper's `.msx` snapshot format is special-cased: exportFileContent
      // does not handle it, so we go through the Pack pipeline directly.
      // `compact: true` matches mapshaper CLI defaults — bakes simplification
      // thresholds into `zz` and gzip-compresses arc buffers for a small file.
      const adapter = getDefaultMapshaperAdapter();
      const files =
        options.format === 'msx'
          ? await adapter.exportPackedDatasets([this._dataset], { compact: true })
          : adapter.exportFileContent(this._dataset, { format: options.format });
      return this._filesToBlob(files, options.format);
    } finally {
      if (savedInterval && arcs?.setRetainedInterval) {
        arcs.setRetainedInterval(savedInterval);
      }
    }
  }

  /**
   * Pack mapshaper's `[{filename, content}]` output into a single Blob.
   * Single-file formats use the first entry directly; shapefile is zipped.
   */
  private _filesToBlob(
    files: Array<{ filename: string; content: string | Uint8Array | ArrayBuffer }>,
    format: ExportFormat,
  ): Blob {
    if (files.length === 0) {
      throw new Error(`mapshaper produced no output for format=${format}`);
    }

    if (format === 'shapefile') {
      const zipInput: Record<string, Uint8Array> = {};
      for (const f of files) {
        zipInput[f.filename] = toUint8Array(f.content);
      }
      const zipped = zipSync(zipInput);
      return new Blob([toBlobPart(zipped)], { type: EXPORT_MIME.shapefile });
    }

    // GeoJSON / TopoJSON: single file, return directly
    return new Blob([toBlobPart(files[0].content)], { type: EXPORT_MIME[format] });
  }

  /**
   * The dataset's layers, or `[]` before the first successful import.
   * Each entry is a {@link MapshaperLayer} (`name`, optional `geometry_type`
   * — `'polygon' | 'polyline' | 'point'`, absent for data-only layers).
   */
  getLayers(): MapshaperLayer[] {
    return this._dataset?.layers || [];
  }

  private _isZipFile(filename: string): boolean {
    return /\.zip$/i.test(filename);
  }

  private async _extractZip(data: Uint8Array): Promise<Record<string, Uint8Array | string>> {
    const limits = { ...DEFAULT_ZIP_LIMITS, ...this._options.zipLimits };
    let uncompressedTotal = 0;
    let entryCount = 0;

    // Async unzip splits the work across microtask boundaries instead of
    // hogging the main thread for the whole archive — the synchronous
    // `unzipSync` form would block for hundreds of ms on a 100 MB shapefile
    // bundle. The `filter` callback retains its strict pre-inflation
    // resource ceilings; throwing from it propagates through the promise
    // rejection.
    const unzipped: Unzipped = await new Promise((resolve, reject) => {
      unzip(
        data,
        {
          filter: (file: UnzipFileInfo) => {
            entryCount++;
            if (entryCount > limits.maxEntries) {
              throw new Error(
                `ZIP extraction limit exceeded: ${entryCount} entries > maxEntries ${limits.maxEntries}`,
              );
            }

            uncompressedTotal += file.originalSize;
            if (uncompressedTotal > limits.maxBytes) {
              throw new Error(
                `ZIP extraction limit exceeded: uncompressed total ${uncompressedTotal} > maxBytes ${limits.maxBytes}`,
              );
            }

            if (data.byteLength > 0) {
              const ratio = uncompressedTotal / data.byteLength;
              if (ratio > limits.maxRatio) {
                throw new Error(
                  `ZIP extraction limit exceeded: ratio ${ratio.toFixed(1)} > maxRatio ${limits.maxRatio}`,
                );
              }
            }

            // Skip metadata and dot files before inflating their payloads.
            // They are still counted above, so they cannot hide bytes or
            // entry count.
            return !(/^__MACOSX/.test(file.name) || file.name.split('/').pop()?.startsWith('.'));
          },
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        },
      );
    });

    const result: Record<string, Uint8Array | string> = {};

    for (const path of Object.keys(unzipped)) {
      const content = unzipped[path];
      const filename = path.split('/').pop() || path;

      // Convert text files to strings
      if (this._isTextFile(filename)) {
        result[filename] = strFromU8(content);
      } else {
        result[filename] = content;
      }
    }

    return result;
  }

  private _isTextFile(filename: string): boolean {
    return /\.(prj|cpg|csv|json|geojson|kml|txt)$/i.test(filename);
  }

  private _findPrimaryFile(files: Record<string, any>): string {
    const filenames = Object.keys(files);

    // Priority: .shp > .geojson > .json > .kml > other
    const priority = ['.shp', '.geojson', '.json', '.kml', '.topojson'];

    for (const ext of priority) {
      const match = filenames.find((f) => f.toLowerCase().endsWith(ext));
      if (match) return match;
    }

    // Return first importable file
    return filenames.find((f) => !this._isAuxiliaryFile(f)) || '';
  }

  private _isAuxiliaryFile(filename: string): boolean {
    return /\.(prj|shx|dbf)$/i.test(filename);
  }
}
