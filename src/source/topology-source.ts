import mapshaper from 'mapshaper';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';
import { unzipSync, strFromU8 } from 'fflate';
import { DisplayArcs } from './display-arcs';
import type { MapshaperDataset } from '../types/mapshaper-types';

/** File size threshold for skipping -clean during import (5MB) */
const LARGE_FILE_THRESHOLD_BYTES = 5 * 1024 * 1024;

export class TopologySource implements ITopologySource {
  public id: string;
  public type: 'topology' = 'topology';
  private _dataset: MapshaperDataset | undefined;
  private _displayArcs: DisplayArcs | null = null;

  constructor(id: string) {
    this.id = id;
  }

  async load(input?: { filename: string, content: Uint8Array }): Promise<void> {
    if (!input) return;

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

    // For large files, skip -clean to speed up import. 
    // Always run -simplify 100% to generate thresholds for dynamic rendering.
    const isLarge = input.content.length > LARGE_FILE_THRESHOLD_BYTES;
    const cleanFlag = isLarge ? '' : '-clean';
    const cmd = `-i ${primaryFile} ${cleanFlag} -merge-layers -simplify 100%`;
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

    // Use mapshaper's -proj command
    // Add -clean BEFORE projection to ensure topology is valid and simplify state is consistent.
    // Also use -clean AFTER could be an option but before is critical for 'flatten' error.
    // Reset any dynamic simplification state before running mapshaper commands.
    // Mapshaper's -proj internally calls flatten(), which crashes if an interval is set but thresholds are missing.
    if (this._dataset?.arcs?.setRetainedInterval) {
      this._dataset.arcs.setRetainedInterval(0);
    }

    const cmd = `-proj ${targetCrs}`;

    return new Promise((resolve, reject) => {
      const job = new mapshaper.internal.Job();

      job.catalog.addDataset(this._dataset);

      const commands = mapshaper.internal.parseCommands(cmd);

      mapshaper.internal.runParsedCommands(commands, job, (err: any, finishedJob: any) => {
        if (err) reject(err);
        else {
          const targets = finishedJob.catalog.getDefaultTargets();
          if (targets.length > 0) {
            this._dataset = targets[0].dataset;
            // Re-initialize DisplayArcs with new arcs after reprojection
            if (this._dataset?.arcs) {
              this._displayArcs = new DisplayArcs(this._dataset.arcs);
            }
            resolve();
          } else {
            // Reprojection might act in-place or return new dataset
            resolve();
          }
        }
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
