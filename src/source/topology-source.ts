import mapshaper from 'mapshaper';
import { EventDispatcher } from '../core/events';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';
import { unzipSync, strFromU8, zipSync } from 'fflate';
import { DisplayArcs } from './display-arcs';
import type { MapshaperDataset } from '../types/mapshaper-types';
import type { ExportFormat, ExportOptions } from './source';

export type TopologySourceData = string | { filename: string, content: Uint8Array };

/** MIME type for each supported export format */
const EXPORT_MIME: Record<ExportFormat, string> = {
  geojson: 'application/geo+json',
  topojson: 'application/json',
  shapefile: 'application/zip',
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

export interface TopologySourceOptions {
  data?: TopologySourceData;
}

export class TopologySource extends EventDispatcher implements ITopologySource {
  public id: string;
  public type: 'topology' = 'topology';
  private _dataset: MapshaperDataset | undefined;
  private _displayArcs: DisplayArcs | null = null;
  private _options: TopologySourceOptions;
  private _data: TopologySourceData | undefined;

  constructor(id: string, options?: TopologySourceOptions) {
    super();
    this.id = id;
    this._options = options || {};
    this._data = this._options.data;

    if (this._data) {
      this._updateData();
    }
  }

  setData(data: TopologySourceData): this {
    this._data = data;
    this._updateData();
    return this;
  }

  private async _updateData(): Promise<void> {
    if (!this._data) return;

    this.fire('dataloading');

    try {
      let input: { filename: string, content: Uint8Array };

      if (typeof this._data === 'string') {
        // Load from URL
        const url = this._data;
        const response = await fetch(url);
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

      let inputFiles: Record<string, Uint8Array | string>;
      let primaryFile = input.filename;

      // Check if this is a zip file
      if (this._isZipFile(input.filename)) {
        inputFiles = this._extractZip(input.content);
        // Find the primary file (.shp, .geojson, etc.)
        primaryFile = this._findPrimaryFile(inputFiles);
        if (!primaryFile) {
          throw new Error('No importable file found in zip archive');
        }
      } else {
        inputFiles = { [input.filename]: input.content };
      }

      // -clean fixes coincident-vertex / overlap / topology issues at import time
      // (matches mapshaper CLI behavior). -simplify 100% precomputes thresholds so
      // dynamic LOD can later switch detail without recomputing.
      const cmd = `-i ${primaryFile} -clean -simplify 100%`;
      const commands = mapshaper.internal.parseCommands(cmd);

      // Inject input files into the import command
      if (commands.length > 0 && commands[0].name === 'i') {
        commands[0].options.input = inputFiles;
      }

      this._dataset = await new Promise((resolve, reject) => {
        mapshaper.internal.runParsedCommands(commands, new mapshaper.internal.Job(), (err: any, job: any) => {
          if (err) reject(err);
          else {
            const targets = job.catalog.getDefaultTargets();
            if (targets.length > 0) {
              resolve(targets[0].dataset);
            } else {
              reject(new Error('No layers found in dataset'));
            }
          }
        });
      });

      // Initialize LOD wrapper for large datasets
      if (this._dataset?.arcs) {
        this._displayArcs = new DisplayArcs(this._dataset.arcs);
      }

      this.fire('data');
    } catch (err: any) {
      this.fire('error', { error: err });
    }
  }

  private _hasSupportedExtension(filename: string): boolean {
    return /\.(json|geojson|topojson|zip|shp|kml)$/i.test(filename);
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

    return new Promise((resolve, reject) => {
      const job = new mapshaper.internal.Job();

      job.catalog.addDataset(this._dataset);

      const commands = mapshaper.internal.parseCommands(cmd);

      mapshaper.internal.runParsedCommands(commands, job, (err: any, finishedJob: any) => {
        if (err) {
          reject(err);
          return;
        }
        const targets = finishedJob.catalog.getDefaultTargets();
        if (targets.length > 0) {
          this._dataset = targets[0].dataset;
        }
        // Re-initialize DisplayArcs (including LOD threshold detection) against
        // the post-projection arcs — coordinates and z-values may have changed.
        if (this._dataset?.arcs) {
          this._displayArcs = new DisplayArcs(this._dataset.arcs);
        }
        resolve();
      });
    });
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
      const files = mapshaper.internal.exportFileContent(this._dataset, {
        format: options.format,
      });
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
    const unzipped = unzipSync(data);
    const result: Record<string, Uint8Array | string> = {};

    for (const [path, content] of Object.entries(unzipped)) {
      // Skip __MACOSX and dot files
      if (/^__MACOSX/.test(path) || path.split('/').pop()?.startsWith('.')) {
        continue;
      }

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
