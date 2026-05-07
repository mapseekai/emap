import mapshaper from 'mapshaper';
import { EventDispatcher } from '../core/events';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';
import { unzipSync, strFromU8, zipSync } from 'fflate';
import type { UnzipFileInfo } from 'fflate';
import { DisplayArcs } from './display-arcs';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { ExportFormat, ExportOptions } from './source';
import {
  getDefaultMapshaperRunner,
  type MapshaperRunner,
} from './mapshaper-runner';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';

export type TopologySourceData = string | { filename: string, content: Uint8Array };

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
  | Array<{ filename: string, content: Uint8Array }>;

/** MIME type for each supported export format */
const EXPORT_MIME: Record<ExportFormat, string> = {
  geojson: 'application/geo+json',
  topojson: 'application/json',
  shapefile: 'application/zip',
  msx: 'application/octet-stream',
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
   * `mapshaper.internal.parseCommands + runParsedCommands` directly.
   * Tests and instrumentation use this to swap in a mock runner.
   */
  mapshaperRunner?: MapshaperRunner;
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
   * Sticky simplification floor. mapshaper's `-simplify` writes a
   * `retainedInterval` into the resulting `ArcCollection`; we cache that
   * value here so the render loop's per-frame zoom-LOD doesn't stomp it.
   * Re-captured on every `setDataset` / `setData`.
   */
  private _simplifyFloor: number = 0;
  private _runner: MapshaperRunner;

  /** Max-detail threshold the user (or last `-simplify` run) asked for. */
  getSimplifyFloor(): number {
    return this._simplifyFloor;
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
    await new Promise<void>((resolve, reject) => {
      let onData: () => void;
      let onError: (event: { error?: unknown }) => void;
      const cleanup = () => {
        source.off('data', onData);
        source.off('error', onError);
      };
      onData = () => {
        cleanup();
        resolve();
      };
      onError = (event) => {
        cleanup();
        reject(event?.error ?? event);
      };
      source.on('data', onData);
      source.on('error', onError);
      source.setData(url);
    });
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
   * Last-write-wins: rapid back-to-back calls supersede each other. Only the
   * latest call's outcome fires `data` / `error`; in-flight URL fetches from
   * superseded calls are aborted.
   */
  setData(data: TopologySourceInput): this {
    this._loadVersion++;
    this._abortController?.abort();
    this._abortController = null;
    this._data = data;
    this._updateData();
    return this;
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
            const extracted = this._extractZip(entry.content);
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
        let input: { filename: string, content: Uint8Array };
        if (typeof this._data === 'string') {
          // Load from URL
          const url = this._data;
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
          }

          const buf = await response.arrayBuffer();
          const content = new Uint8Array(buf);

          const urlPath = new URL(url).pathname;
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
          const extracted = this._extractZip(input.content);
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

      // Match mapshaper GUI's import path: bare `-i FILE [FILE2 ...]`.
      // mapshaper's importContent runs cleanPathsAfterImport (deduplication
      // + defective-path removal) and buildTopology (coincident-endpoint
      // sharing required by topology-aware vertex editing), both cheap.
      // We deliberately do NOT run `-clean` or `-simplify 100%` here — both
      // are O(N²) / O(N log N) and make interactive imports of moderate-
      // sized files unusable. Callers run `Emap.ops.cleanLayer()` /
      // `source.simplifyArcs()` explicitly when they need those passes.
      const cmd = `-i ${primaryFiles.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(' ')}`;
      const dataset: MapshaperDataset = await this._runner.runImport(cmd, inputFiles);

      // Stale guard: another setData superseded this run while it was awaiting.
      // Drop the result silently — the live chain owns the next data/error.
      if (version !== this._loadVersion) return;

      this._dataset = dataset;
      // Initialize LOD wrapper for large datasets
      if (this._dataset?.arcs) {
        this._displayArcs = new DisplayArcs(this._dataset.arcs);
      }
      this._simplifyFloor = this._dataset?.arcs?.getRetainedInterval?.() ?? 0;

      this.fire('data', { reason: 'load' });
    } catch (err: any) {
      // Stale chain (either superseded by a newer setData, or its fetch was
      // aborted by us). Either way, the new chain owns the next event.
      if (version !== this._loadVersion) return;
      if (err?.name === 'AbortError') return;
      this.fire('error', { error: err });
    }
  }

  private _hasSupportedExtension(filename: string): boolean {
    return /\.(json|geojson|topojson|zip|shp|kml|msx)$/i.test(filename);
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
      'text/plain': '.json',
    };
    const ext = extMap[ct] || '.json';
    return (fallbackName || 'data') + ext;
  }

  public getDataset(): MapshaperDataset | undefined {
    return this._dataset;
  }

  public getCRS(): string {
    if (!this._dataset) return 'EPSG:4326';

    const info = this._dataset.info;

    if (!info) return 'EPSG:4326';

    // Try to get crs_string (e.g. "wgs84", "epsg:4326")
    if (info.crs_string) {
      return this._normalizeCrsString(info.crs_string);
    }

    // Try to extract from prj (WKT-style projection string)
    if (info.prj) {
      // Look for EPSG code in WKT AUTHORITY clause
      const authorityMatch = info.prj.match(/AUTHORITY\["EPSG"\s*,\s*"(\d+)"\]/i);
      if (authorityMatch) {
        return `EPSG:${authorityMatch[1]}`;
      }

      // Detect Web Mercator from projection name
      if (/Mercator.*WGS.*84.*Pseudo/i.test(info.prj) ||
        /WGS.*84.*Pseudo.*Mercator/i.test(info.prj) ||
        /Web_Mercator/i.test(info.prj)) {
        return 'EPSG:3857';
      }

      // Detect WGS84 from DATUM
      if (/DATUM\["WGS_1984"/i.test(info.prj) && /GEOGCS/i.test(info.prj)) {
        return 'EPSG:4326';
      }
    }

    // Try to detect from CRS object properties (parsed by Mapshaper)
    if (info.crs) {
      if (info.crs.is_latlong) {
        return 'EPSG:4326'; // WGS84
      }
      // Check for Web Mercator by projection parameters
      if (info.crs.projName === 'merc' && info.crs.a === 6378137) {
        return 'EPSG:3857';
      }
    }

    // Default to WGS84
    return 'EPSG:4326';
  }

  private _normalizeCrsString(str: string): string {
    const lower = str.toLowerCase();
    if (lower === 'wgs84' || lower.includes('4326')) {
      return 'EPSG:4326';
    }
    if (lower.includes('3857') || lower === 'webmercator') {
      return 'EPSG:3857';
    }
    // Return as-is if it looks like EPSG:XXXX
    if (/^epsg:\d+$/i.test(str)) {
      return str.toUpperCase();
    }
    return str.toUpperCase();
  }

  public async reproject(targetCrs: string): Promise<void> {
    if (!this._dataset) return;

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

    const cmd = `-proj ${targetCrs}`;

    const result = await getDefaultMapshaperAdapter().runOnDataset(cmd, this._dataset);
    this._dataset = result;
    // Re-initialize DisplayArcs (including LOD threshold detection) against
    // the post-projection arcs — coordinates and z-values may have changed.
    if (this._dataset?.arcs) {
      this._displayArcs = new DisplayArcs(this._dataset.arcs);
    }
  }

  getExtent(): Bounds {
    if (!this._dataset) return new Bounds();
    const info = mapshaper.internal.getDatasetBounds(this._dataset);
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
   * Re-initialize DisplayArcs from the current dataset arcs.
   * Call after modifying the arc collection (e.g. adding new features).
   */
  refreshDisplayArcs(): void {
    if (this._dataset?.arcs) {
      this._displayArcs = new DisplayArcs(this._dataset.arcs);
    }
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
      // mapshaper's `.msx` snapshot format is special-cased: exportFileContent
      // does not handle it, so we go through the Pack pipeline directly.
      // `compact: true` matches mapshaper CLI defaults — bakes simplification
      // thresholds into `zz` and gzip-compresses arc buffers for a small file.
      const files = options.format === 'msx'
        ? await mapshaper.internal.exportPackedDatasets([this._dataset], { compact: true })
        : mapshaper.internal.exportFileContent(this._dataset, { format: options.format });
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

  getLayers(): any[] {
    return this._dataset?.layers || [];
  }

  private _isZipFile(filename: string): boolean {
    return /\.zip$/i.test(filename);
  }

  private _extractZip(data: Uint8Array): Record<string, Uint8Array | string> {
    const limits = { ...DEFAULT_ZIP_LIMITS, ...this._options.zipLimits };
    let uncompressedTotal = 0;
    let entryCount = 0;

    const unzipped = unzipSync(data, {
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

        // Skip metadata and dot files before inflating their payloads. They are
        // still counted above, so they cannot hide bytes or entry count.
        return !(/^__MACOSX/.test(file.name) || file.name.split('/').pop()?.startsWith('.'));
      },
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
      const match = filenames.find(f => f.toLowerCase().endsWith(ext));
      if (match) return match;
    }

    // Return first importable file
    return filenames.find(f => !this._isAuxiliaryFile(f)) || '';
  }

  private _isAuxiliaryFile(filename: string): boolean {
    return /\.(prj|shx|dbf)$/i.test(filename);
  }
}
