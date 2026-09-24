import type { FormatRegistryContract } from '../../runtime/services/formats';
import { EventDispatcher } from '../../engine/core/events';
import { createLayerDataset, type CreateLayerOptions } from './create-layer';
import { bindLayerFields } from './layer-fields';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';
import { unzip, strFromU8, zipSync } from 'fflate';
import type { UnzipFileInfo, Unzipped } from 'fflate';
import { DisplayArcs } from './display-arcs';
import type {
  MapshaperDataset,
  ReadonlyArcCollection,
  ReadonlyMapshaperDataset,
  ReadonlyMapshaperLayer,
} from '../../shared/types/mapshaper-types';
import type {
  DatasetNormalizer,
  ExportFormat,
  ExportOptions,
  NormalizedDatasetCommit,
} from './source';
import {
  getDefaultMapshaperAdapter,
  parseMapshaperCrs,
  type MapshaperAdapter,
} from '../../integrations/mapshaper/adapter';
import {
  normalizeProjectCrsMetadata,
  resolveDatasetCRS,
  resolveDatasetCRSMetadata,
  resolveProjectCrs,
  setDatasetCrsMetadata,
} from '../geo/crs-resolver';
import { FormatRegistry, getFileExtension, isKnownPluginExtension } from './format-registry';
import {
  assertImportInputBytes,
  resolveImportResourceLimits,
  type ImportResourceLimits,
} from '../../shared/import-resource-limits';

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
  flatgeobuf: 'application/x-flatgeobuf',
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

/** Type guard for the commit-guarded normalizer result. */
function isNormalizedDatasetCommit(
  value: MapshaperDataset | NormalizedDatasetCommit,
): value is NormalizedDatasetCommit {
  return typeof (value as NormalizedDatasetCommit).assertCommittable === 'function';
}

/**
 * Resource ceilings applied by {@link TopologySource} when extracting a ZIP
 * payload. Defaults are intentionally generous so legitimate shapefile zips
 * keep working unchanged. Apps that load adversarial / public-internet zips
 * should lower them.
 */
export interface ZipExtractionLimits {
  /** Max compressed ZIP input size, in bytes. Default 2 GiB. */
  maxCompressedBytes?: number;
  /** Max summed uncompressed size of all kept entries, in bytes. Default 2 GiB. */
  maxBytes?: number;
  /** Max entry count fflate may yield. Default 5000. */
  maxEntries?: number;
  /** Max `uncompressedTotal / compressedInput` ratio. Default 100. */
  maxRatio?: number;
}

const DEFAULT_ZIP_BYTE_LIMIT = 2 * 1024 * 1024 * 1024;

const DEFAULT_ZIP_LIMITS: Required<ZipExtractionLimits> = {
  maxCompressedBytes: DEFAULT_ZIP_BYTE_LIMIT,
  maxBytes: DEFAULT_ZIP_BYTE_LIMIT,
  maxEntries: 5000,
  maxRatio: 100,
};

function resolveZipLimits(limits: ZipExtractionLimits | undefined): Required<ZipExtractionLimits> {
  return { ...DEFAULT_ZIP_LIMITS, ...limits };
}

function assertCompressedZipSize(byteLength: number, limits: Required<ZipExtractionLimits>): void {
  if (byteLength > limits.maxCompressedBytes) {
    throw new Error(
      `ZIP extraction limit exceeded: compressed input ${byteLength} > maxCompressedBytes ${limits.maxCompressedBytes}`,
    );
  }
}

async function readResponseBytes(response: Response, maxInputBytes: number): Promise<Uint8Array> {
  const declared = response.headers.get('Content-Length');
  if (declared !== null) {
    const byteLength = Number(declared);
    if (Number.isFinite(byteLength) && byteLength >= 0) {
      assertImportInputBytes(byteLength, maxInputBytes);
    }
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertImportInputBytes(bytes.byteLength, maxInputBytes);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      assertImportInputBytes(total + value.byteLength, maxInputBytes);
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) return chunks[0];
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export interface TopologySourceOptions {
  /** Format registry supplied by the workspace or standalone caller. */
  formats?: FormatRegistryContract;
  data?: TopologySourceInput;
  /** Raw input byte ceiling shared by URL, in-memory and plugin-backed imports. */
  resourceLimits?: Partial<ImportResourceLimits>;
  zipLimits?: ZipExtractionLimits;
  /** Adapter used for every mapshaper import, transform, bounds and export operation. */
  adapter?: MapshaperAdapter;
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
  /** Create a detached empty layer with a name, CRS and optional field defaults. */
  static async create(id: string, options: CreateLayerOptions): Promise<TopologySource> {
    if (!id.trim()) throw new Error('Source id is required');
    const dataset = await createLayerDataset(options);
    const source = new TopologySource(id);
    source.setDataset(dataset, false);
    return source;
  }

  public id: string;
  public type: 'topology' = 'topology';
  private _dataset: MapshaperDataset | undefined;
  private _displayArcs: DisplayArcs | null = null;
  private _displayArcsRevision: number | undefined = -1;
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
  private _adapter: MapshaperAdapter;
  private _formats: FormatRegistryContract;
  private _formatOwner: object | null = null;
  private _datasetNormalizer: DatasetNormalizer | null = null;
  private _managedCrs: (() => string) | null = null;

  /** @internal A mutable source has exactly one workspace owner. */
  bindFormatRegistry(formats: FormatRegistryContract): () => void {
    if (this._formatOwner)
      throw new Error(`TopologySource "${this.id}" already belongs to a workspace`);
    const previous = this._formats;
    const owner = {};
    this._formats = formats;
    this._formatOwner = owner;
    return () => {
      if (this._formatOwner !== owner) return;
      this._formats = previous;
      this._formatOwner = null;
    };
  }

  /** @internal Install the map-owned pre-commit dataset normalization hook. */
  setDatasetNormalizer(normalizer: DatasetNormalizer | null): void {
    this._datasetNormalizer = normalizer;
  }

  /** Replace external input, invalidating history tied to the previous dataset. */
  async replaceDataset(dataset: MapshaperDataset): Promise<void> {
    const currentDataset = this._dataset;
    const currentEditVersion = currentDataset?.editVersion ?? 0;
    const currentAttributeVersion = currentDataset?.attributeVersion ?? 0;
    const loadVersion = this._loadVersion;
    const normalizer = this._datasetNormalizer;
    const normalized = normalizer ? await normalizer(dataset) : dataset;

    if (
      this._dataset !== currentDataset ||
      (currentDataset?.editVersion ?? 0) !== currentEditVersion ||
      (currentDataset?.attributeVersion ?? 0) !== currentAttributeVersion ||
      this._loadVersion !== loadVersion ||
      this._datasetNormalizer !== normalizer
    ) {
      throw new Error(`TopologySource "${this.id}" changed during dataset replacement`);
    }

    if (isNormalizedDatasetCommit(normalized)) {
      normalized.assertCommittable();
      this.setDataset(normalized.dataset, false);
    } else {
      this.setDataset(normalized, false);
    }
    // Keep reason='replace' for consumers; only external replacements reset
    // map history. EditCommand replay deliberately does not set this origin.
    this.fire('data', { reason: 'replace', origin: 'external' });
  }

  /** @internal Set or clear the owning map's authoritative CRS provider. */
  setManagedCRS(getCrs: (() => string) | null): void {
    this._managedCrs = getCrs;
  }

  /** @internal Max-detail threshold the user (or last `-simplify` run) asked for. */
  getSimplifyFloor(): number {
    return this._simplifyFloor;
  }

  constructor(id: string, options?: TopologySourceOptions) {
    super();
    this.id = id;
    const { data, adapter, formats, ...sourceOptions } = options ?? {};
    this._options = sourceOptions;
    this._data = data;
    this._adapter = adapter ?? getDefaultMapshaperAdapter();
    this._formats = formats ?? new FormatRegistry();

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
   *
   * @param id Required source id string; must be a valid unique source id for
   * the target map. It cannot be omitted because the returned source is
   * constructed with this id.
   * @param bytes Required raw file bytes; must be a `Uint8Array` or
   * `ArrayBuffer` containing GeoJSON, TopoJSON, Shapefile ZIP, or another
   * supported format. Omitted bytes are invalid because mapshaper needs
   * content to import.
   * @param options Optional source settings. When omitted, `filename` defaults
   * to `${id}.geojson`; when supplied, `filename` must use a supported import
   * extension such as `.geojson`, `.topojson`, `.json`, `.zip`, `.shp`, `.kml`,
   * or `.msx`.
   *
   * @example
   * const response = await fetch('/data/points.geojson');
   * const source = await TopologySource.fromBytes('points', await response.arrayBuffer(), {
   *   filename: 'points.geojson',
   * });
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
    const data = this._data;
    if (data === undefined) return;

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
      const resourceLimits = resolveImportResourceLimits(this._options.resourceLimits);

      if (Array.isArray(data)) {
        // Multi-file import: each entry becomes its own layer in one dataset
        // (same behaviour as mapshaper CLI `-i FILE1 FILE2 ...`).
        if (data.length === 0) {
          throw new Error('setData received an empty array; nothing to import');
        }
        let totalInputBytes = 0;
        for (const entry of data) {
          totalInputBytes += entry.content.byteLength;
          assertImportInputBytes(totalInputBytes, resourceLimits.maxInputBytes);
        }
        const originsByBasename = new Map<string, string>();
        const addInputFile = (filename: string, content: Uint8Array | string, origin: string) => {
          const basename = filename.split('/').pop() || filename;
          const key = basename.toLowerCase();
          const previousOrigin = originsByBasename.get(key);
          if (previousOrigin !== undefined) {
            throw new Error(
              `Import contains duplicate basename "${basename}" in "${previousOrigin}" and "${origin}"`,
            );
          }
          originsByBasename.set(key, origin);
          inputFiles[filename] = content;
        };
        for (const entry of data) {
          if (this._isZipFile(entry.filename)) {
            const extracted = await this._extractZip(entry.content);
            const primaries = this._findPrimaryFiles(extracted);
            if (primaries.length === 0) {
              throw new Error(`No Shapefile (.shp) found in zip archive: ${entry.filename}`);
            }
            for (const [name, content] of Object.entries(extracted)) {
              addInputFile(name, content, `${entry.filename}/${name}`);
            }
            primaryFiles.push(...primaries);
          } else {
            // KML goes through DOMParser and needs a string, not bytes.
            addInputFile(
              entry.filename,
              /\.kml$/i.test(entry.filename) ? strFromU8(entry.content) : entry.content,
              entry.filename,
            );
            primaryFiles.push(entry.filename);
          }
        }
      } else {
        let input: { filename: string; content: Uint8Array };
        if (typeof data === 'string') {
          // Load from URL
          const url = data;
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
          }

          const urlPath = this._pathnameFromUrl(url);
          let filename = urlPath.split('/').pop() || '';

          if (!this._hasSupportedExtension(filename)) {
            const contentType = response.headers.get('Content-Type') || '';
            filename = this._filenameFromContentType(contentType, filename);
          }

          if (!filename) {
            filename = 'data.json';
          }

          const zipLimits = this._isZipFile(filename)
            ? resolveZipLimits(this._options.zipLimits)
            : null;
          if (zipLimits) {
            const declared = response.headers.get('Content-Length');
            if (declared !== null) {
              const byteLength = Number(declared);
              if (Number.isFinite(byteLength) && byteLength >= 0) {
                assertCompressedZipSize(byteLength, zipLimits);
              }
            }
          }
          const maxInputBytes = zipLimits
            ? Math.min(resourceLimits.maxInputBytes, zipLimits.maxCompressedBytes)
            : resourceLimits.maxInputBytes;
          const content = await readResponseBytes(response, maxInputBytes);
          input = { filename, content };
        } else {
          assertImportInputBytes(data.content.byteLength, resourceLimits.maxInputBytes);
          input = data;
        }

        if (this._isZipFile(input.filename)) {
          const extracted = await this._extractZip(input.content);
          const primaries = this._findPrimaryFiles(extracted);
          if (primaries.length === 0) {
            throw new Error('No Shapefile (.shp) found in zip archive');
          }
          for (const [name, content] of Object.entries(extracted)) {
            inputFiles[name] = content;
          }
          primaryFiles.push(...primaries);
        } else {
          // Match the ZIP path: hand KML to mapshaper as a string; its
          // importer passes content straight to DOMParser.
          inputFiles[input.filename] = /\.kml$/i.test(input.filename)
            ? strFromU8(input.content)
            : input.content;
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
      let dataset: MapshaperDataset = pluginImport
        ? await pluginImport
        : await this._adapter.runImport(cmd, inputFiles);

      const inputFormats = dataset.info?.input_formats ?? [];
      const isShapefileOnly =
        primaryFiles.length > 0 && primaryFiles.every((filename) => /\.shp$/i.test(filename));
      const isTopoJsonOnly =
        inputFormats.length > 0 && inputFormats.every((format) => format === 'topojson');
      const isGeoParquetOnly =
        primaryFiles.length === 1 && /\.(?:parquet|geoparquet)$/i.test(primaryFiles[0]!);
      if (isShapefileOnly || isTopoJsonOnly || isGeoParquetOnly) {
        // Shapefile, TopoJSON and GeoParquet may carry a hole tangent to its
        // shell as one pinched ring; restore simple rings before CRS
        // normalization or editing sees the dataset. Mixed mapshaper imports
        // are not normalized as one unit: layer provenance is unavailable
        // after datasets are combined, so a dataset-wide rewrite would mutate
        // unrelated data. Plugin imports are single-file by contract.
        this._adapter.splitSelfIntersectingPolygonRings(dataset);
      }

      if (
        resolveDatasetCRSMetadata(dataset) === undefined &&
        primaryFiles.every((f) => WGS84_SPEC_FORMAT_RE.test(f))
      ) {
        dataset.info ??= {};
        dataset.info.crs_string = 'EPSG:4326';
      }

      let normalized: MapshaperDataset | NormalizedDatasetCommit | undefined;
      if (this._datasetNormalizer) {
        normalized = await this._datasetNormalizer(dataset);
      }

      // Stale guard: another setData superseded this run while it was awaiting.
      // Drop the result silently — the live chain owns the next data/error.
      if (version !== this._loadVersion) return;

      if (normalized !== undefined) {
        if (isNormalizedDatasetCommit(normalized)) {
          // Last-moment check: the map state that authorized the
          // normalization (registration, active CRS) must still hold.
          normalized.assertCommittable();
          dataset = normalized.dataset;
        } else {
          dataset = normalized;
        }
      }

      this._dataset = dataset;
      // Initialize LOD wrapper for large datasets
      if (this._dataset?.arcs) {
        this._displayArcs = new DisplayArcs(this._dataset.arcs);
      }
      this._displayArcsRevision = this._dataset?.editVersion;
      this._simplifyFloor = this._dataset?.arcs?.getRetainedInterval?.() ?? 0;
      this._data = undefined;

      this.fire('data', { reason: 'load' });
      this._resolvePending(version);
    } catch (err: unknown) {
      // Stale chain (either superseded by a newer setData, or its fetch was
      // aborted by us). Either way, the new chain owns the next event.
      if (version !== this._loadVersion) return;
      // Current owner cancellation rejects setData. Only obsolete load versions
      // are ignored above; otherwise its promise would never settle.
      this._data = undefined;
      this.fire('error', { error: err });
      this._rejectPending(version, err);
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
  ): Promise<MapshaperDataset> | null {
    const pluginFile = primaryFiles.find(
      (f) =>
        this._formats.getFormatForExtension(getFileExtension(f)) ||
        isKnownPluginExtension(getFileExtension(f)),
    );
    if (!pluginFile) return null;
    const ext = getFileExtension(pluginFile);
    const plugin = this._formats.getFormatForExtension(ext);
    if (!plugin) {
      throw new Error(
        `'.${ext}' import requires a registered format plugin — ` +
          `register the codec on the source formats (arrowFormatsPlugin from '@mapseekai/emap/arrow') before setData`,
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
    return (
      !!this._formats.getFormatForExtension(getFileExtension(filename)) ||
      /\.(json|geojson|topojson|zip|shp|kml|msx|parquet|geoparquet|arrow|arrows|feather|fgb)$/i.test(
        filename,
      )
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

  public getDataset(): ReadonlyMapshaperDataset | undefined {
    return this._dataset;
  }

  /** @internal */
  public async prepareReprojectDataset(
    dataset: MapshaperDataset,
    targetCrs: string,
    targetCrsMetadata?: string,
  ): Promise<MapshaperDataset> {
    const resolvedTargetCrs = await resolveProjectCrs(targetCrs);
    const metadataCrs = targetCrsMetadata ?? normalizeProjectCrsMetadata(targetCrs);
    const working = this._adapter.copyDataset(dataset);
    working.arcs?.setRetainedInterval?.(0);
    // GeoParquet carries a serializable CRS label in `crs_string`, while
    // Mapshaper's `-proj` reads the source CRS from this runtime object.
    // Imported Shapefiles already have `info.crs` or `info.prj`; only fill
    // the missing operational representation here.
    if (!working.info?.crs && working.info?.crs_string) {
      working.info.crs = parseMapshaperCrs(await resolveProjectCrs(working.info.crs_string));
    }
    const result = await this._adapter.runOnDataset(`-proj ${resolvedTargetCrs}`, working);
    if (result.info) {
      delete result.info.crs_string;
      delete result.info.prj;
      delete result.info.wkt1;
    }
    setDatasetCrsMetadata(result, metadataCrs);
    return result;
  }

  /** @internal */
  public async prepareReproject(
    targetCrs: string,
    targetCrsMetadata?: string,
  ): Promise<MapshaperDataset> {
    if (!this._dataset) {
      throw new Error(`TopologySource "${this.id}" has no dataset to reproject`);
    }
    return this.prepareReprojectDataset(this._dataset, targetCrs, targetCrsMetadata);
  }

  /**
   * Canonical CRS identifier for the loaded dataset (`EPSG:NNNN` or a
   * passthrough label). Heuristics live in {@link resolveDatasetCRS} so the
   * resolution can be unit-tested independently of TopologySource.
   */
  public getCRS(): string {
    return resolveDatasetCRS(this._dataset);
  }

  /**
   * Reproject a detached source in place.
   *
   * A map-managed source can only be reprojected to the map's current CRS.
   * Use `map.reproject()` to change the CRS of a registered source.
   */
  public async reproject(targetCrs: string, targetCrsMetadata?: string): Promise<void> {
    const managedCrsProvider = this._managedCrs;
    const managedCrs = managedCrsProvider?.();
    const startDataset = this._dataset;
    const editVersion = startDataset?.editVersion ?? 0;
    const attributeVersion = startDataset?.attributeVersion ?? 0;
    const loadVersion = this._loadVersion;
    let resolvedManaged: string | undefined;
    if (managedCrs) {
      const [resolvedTarget, managed] = await Promise.all([
        resolveProjectCrs(targetCrs),
        resolveProjectCrs(managedCrs),
      ]);
      if (resolvedTarget !== managed) {
        throw new Error(
          `TopologySource "${this.id}" is managed by a map; use map.reproject() to change its CRS`,
        );
      }
      resolvedManaged = managed;
      // The owning map's CRS is authoritative: pin the target and metadata
      // instead of trusting caller-provided metadata.
      targetCrs = managedCrs;
      targetCrsMetadata = normalizeProjectCrsMetadata(managedCrs) ?? managedCrs;
    }
    const prepared = await this.prepareReproject(targetCrs, targetCrsMetadata);
    if (managedCrs) {
      // The map may have reprojected (or detached this source) while the
      // asynchronous preparation was in flight; never commit a stale target.
      const currentManaged = this._managedCrs?.();
      if (!currentManaged || (await resolveProjectCrs(currentManaged)) !== resolvedManaged) {
        throw new Error(`Map CRS changed during reprojection of source "${this.id}"`);
      }
    }
    if (
      this._dataset !== startDataset ||
      (startDataset?.editVersion ?? 0) !== editVersion ||
      (startDataset?.attributeVersion ?? 0) !== attributeVersion ||
      this._loadVersion !== loadVersion ||
      this._managedCrs !== managedCrsProvider
    ) {
      throw new Error(`TopologySource "${this.id}" changed during reprojection`);
    }
    // Public source reprojection is an external replacement, not a history
    // replay. The map normalizer also rejects commits into an active transaction.
    await this.replaceDataset(prepared);
  }

  getExtent(): Bounds {
    if (!this._dataset) return new Bounds();
    const info = this._adapter.getDatasetBounds(this._dataset);
    return new Bounds(info.xmin, info.ymin, info.xmax, info.ymax);
  }

  getArcs(): ReadonlyArcCollection | undefined {
    return this._dataset?.arcs;
  }

  /**
   * Returns the DisplayArcs wrapper for LOD support.
   * Use getScaledArcs(unitsPerPixel) to get the appropriate LOD.
   * @internal
   */
  getDisplayArcs(): DisplayArcs | null {
    return this._displayArcs;
  }

  /**
   * Mark the cached LOD copy stale; the next `getScaledArcs()` call inside
   * the renderer will rebuild it lazily. Cheap (O(1)) so per-frame edit
   * sessions can call this on every step without paying the rebuild cost
   * until the user actually zooms out far enough to need the filtered copy.
   * @internal
   */
  markDisplayArcsDirty(): void {
    this._displayArcs?.markDirty();
  }

  /**
   * Eagerly re-initialize DisplayArcs from the current dataset arcs. Use
   * for one-shot mutations where the caller wants the new LOD copy ready
   * immediately (project, dataset-replace). Per-frame in-place edits
   * should prefer {@link markDisplayArcsDirty}.
   * @internal
   */
  refreshDisplayArcs(): void {
    if (this._dataset?.arcs) {
      this._displayArcs = new DisplayArcs(this._dataset.arcs);
      this._displayArcsRevision = this._dataset.editVersion;
    }
  }

  /**
   * Swap the active dataset. Used by dataset-replace commands (clip / erase /
   * dissolve / …) and by reproject. Rebuilds the LOD copy and notifies
   * listeners with the `data` event.
   * @internal
   */
  public setDataset(dataset: MapshaperDataset, notify = true): void {
    for (const layer of dataset.layers) bindLayerFields(layer);
    // Source registration changes CRS metadata on a shallow dataset wrapper.
    // Keep the already prepared LOD only for that silent, unchanged-geometry
    // commit. Explicit replacements and versioned/in-place edits still rebuild.
    const keepDisplay =
      !notify &&
      dataset !== this._dataset &&
      dataset.layers === this._dataset?.layers &&
      dataset.arcs !== undefined &&
      this._displayArcs?.getArcs() === dataset.arcs &&
      this._displayArcsRevision === dataset.editVersion;
    this._dataset = dataset;
    if (dataset.arcs) {
      if (!keepDisplay) this._displayArcs = new DisplayArcs(dataset.arcs);
    } else {
      this._displayArcs = null;
    }
    this._displayArcsRevision = dataset.editVersion;
    // Re-capture the simplification floor: mapshaper's `-simplify` writes
    // a non-zero `retainedInterval` here; other ops typically leave it at 0.
    this._simplifyFloor = dataset.arcs?.getRetainedInterval?.() ?? 0;
    if (notify) {
      // `replace` distinguishes edit-driven dataset swaps from initial `load` —
      // listeners that auto-fit the viewport should only react to `load`.
      this.fire('data', { reason: 'replace' });
    }
  }

  /**
   * Serialize the current dataset to one browser `Blob`.
   *
   * Mapshaper handles `geojson`, `topojson`, `shapefile`, and `msx`.
   * Registered format plugins handle `geoparquet`, `geoarrow`, and
   * `flatgeobuf`; import `@mapseekai/emap/arrow` for the Arrow formats and
   * register a FlatGeobuf plugin before exporting that format. Multi-file
   * shapefile output is packed into one ZIP Blob using fflate.
   * TopoJSON preserves coordinates by default; `quantization: true` opts
   * into a smaller but lossy automatic coordinate grid.
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
      const pluginHandler = this._formats.getExportHandler(options.format);
      if (pluginHandler) {
        const files = await pluginHandler(this._dataset, options);
        return this._filesToBlob(files, options.format);
      }
      if (options.format === 'geoparquet' || options.format === 'geoarrow') {
        throw new Error(
          `'${options.format}' export requires the emap Arrow module — ` +
            `mount arrowFormatsPlugin from '@mapseekai/emap/arrow' or register the codec on the source formats before export`,
        );
      }
      if (options.format === 'flatgeobuf') {
        throw new Error(
          "'flatgeobuf' export requires a registered FlatGeobuf format plugin — " +
            'register the codec on the source formats before export',
        );
      }
      // mapshaper's `.msx` snapshot format is special-cased: exportFileContent
      // does not handle it, so we go through the Pack pipeline directly.
      // MSX packs the raw arc table; `compact: true` gzip-compresses vertex
      // buffers and bakes simplification thresholds via `flattenArcs`, but does
      // NOT drop orphan arcs left behind by direct edits. Serialize a compacted
      // copy so history lifetime never forces live-dataset arc compaction
      // (which would invalidate captured ids).
      const adapter = this._adapter;
      let files;
      if (options.format === 'msx') {
        const copy = adapter.copyDataset(this._dataset);
        adapter.cleanArcReferences(copy);
        files = await adapter.exportPackedDatasets([copy], { compact: true });
      } else {
        // GeoJSON iterates shapes (orphans drop out naturally); TopoJSON
        // export dissolves arcs on its own copy. Both stay untouched.
        files = adapter.exportFileContent(this._dataset, {
          format: options.format,
          // Internal storage must not move vertices on every save/import.
          // Mapshaper's automatic TopoJSON grid is lossy and may change after
          // topology reconstruction, so quantization must be explicit.
          ...(options.format === 'topojson'
            ? { no_quantization: options.quantization !== true }
            : {}),
        });
      }
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
    return new Blob([toBlobPart(files[0].content)], {
      type: this._formats.getMimeType(format) ?? EXPORT_MIME[format] ?? 'application/octet-stream',
    });
  }

  /**
   * The dataset's layers, or `[]` before the first successful import.
   * Each entry is a {@link MapshaperLayer} (`name`, optional `geometry_type`
   * — `'polygon' | 'polyline' | 'point'`, absent for data-only layers).
   */
  getLayers(): readonly ReadonlyMapshaperLayer[] {
    return this._dataset?.layers || [];
  }

  private _isZipFile(filename: string): boolean {
    return /\.zip$/i.test(filename);
  }

  private async _extractZip(data: Uint8Array): Promise<Record<string, Uint8Array | string>> {
    const limits = resolveZipLimits(this._options.zipLimits);
    assertCompressedZipSize(data.byteLength, limits);
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
            return (
              !(/^__MACOSX/.test(file.name) || file.name.split('/').pop()?.startsWith('.')) &&
              /\.(shp|shx|dbf|prj|cpg)$/i.test(file.name)
            );
          },
        },
        (err, result) => {
          if (err) reject(err);
          else resolve(result);
        },
      );
    });

    const result: Record<string, Uint8Array | string> = {};
    const pathsByBasename = new Map<string, string>();

    for (const path of Object.keys(unzipped)) {
      const content = unzipped[path];
      const filename = path.split('/').pop() || path;
      const basenameKey = filename.toLowerCase();
      const previousPath = pathsByBasename.get(basenameKey);
      if (previousPath !== undefined && previousPath !== path) {
        throw new Error(
          `ZIP archive contains duplicate basename "${filename}" in "${previousPath}" and "${path}"`,
        );
      }
      pathsByBasename.set(basenameKey, path);

      // Convert text files to strings
      if (this._isTextFile(filename)) {
        result[filename] = strFromU8(content);
      } else {
        result[filename] = content;
      }
    }

    // One archive is one dataset with independent Shapefile layers. Apply
    // its first available PRJ to every layer before mapshaper combines them,
    // so later PRJs cannot override it or trigger incompatible-CRS checks.
    // This assigns CRS metadata only; coordinates are not reprojected.
    const shapefiles = Object.keys(result).filter((filename) => /\.shp$/i.test(filename));
    let firstPrj: string | undefined;
    for (const filename of shapefiles) {
      const prjName = pathsByBasename.get(filename.replace(/\.shp$/i, '.prj').toLowerCase());
      const prj = prjName && result[prjName.split('/').pop()!];
      if (typeof prj === 'string' && prj.trim()) {
        firstPrj = prj;
        break;
      }
    }
    for (const filename of Object.keys(result)) {
      if (/\.prj$/i.test(filename)) delete result[filename];
    }
    if (firstPrj !== undefined) {
      for (const filename of shapefiles) {
        result[filename.replace(/\.shp$/i, '.prj')] = firstPrj;
      }
    }
    return result;
  }

  private _isTextFile(filename: string): boolean {
    return /\.(prj|cpg|csv|json|geojson|kml|txt)$/i.test(filename);
  }

  private _findPrimaryFiles(files: Record<string, unknown>): string[] {
    return Object.keys(files).filter((filename) => /\.shp$/i.test(filename));
  }
}
