import { EventDispatcher } from '../core/events';
import type { ArcCollection, MapshaperDataset } from '../types/mapshaper-types';
import type { DisplayArcs } from './display-arcs';
import type { Bounds } from '../geo/bounds';

export interface Source extends EventDispatcher {
  id: string;
  type: 'topology' | 'geojson';
  getExtent(): Bounds;
}

/** File formats emap can serialize a dataset to. Mirrors the import format set. */
export type ExportFormat = 'geojson' | 'topojson' | 'shapefile' | 'msx';

/** Options for {@link TopologySource.export}. */
export interface ExportOptions {
  format: ExportFormat;
}

export interface TopologySource extends Source {
  type: 'topology';
  getArcs(): ArcCollection | undefined;
  getLayers(): any[];
  getDataset(): MapshaperDataset | undefined;
  getDisplayArcs(): DisplayArcs | null;
  /**
   * Re-initialize the LOD copy in DisplayArcs from the current dataset arcs.
   * Call after any edit that mutates arc vertex layout (insert / delete / append).
   */
  refreshDisplayArcs(): void;
  /**
   * Replace the active dataset (used by undo/redo of dataset-replace commands
   * and by reproject). Rebuilds DisplayArcs and fires the `data` event so the
   * map re-renders.
   */
  setDataset(dataset: MapshaperDataset): void;
  /**
   * Sticky simplification floor (in arc-Z units). Set by the most recent
   * `-simplify` run via `setDataset`; cleared on a fresh load. The render
   * loop uses this as a lower-bound for `setRetainedInterval` so the
   * per-frame zoom-LOD never re-introduces detail the user filtered out.
   */
  getSimplifyFloor?(): number;
  /**
   * Serialize the current in-memory dataset to a browser `Blob`.
   *
   * Always emits full-detail geometry; the source's render-time LOD interval
   * is restored before the promise resolves.
   *
   * - `geojson` / `topojson` — single-file output, returned as `application/json`
   * - `shapefile` — multi-file output (.shp/.shx/.dbf/.prj), returned as a
   *   single `application/zip` Blob packed via fflate
   */
  export(options: ExportOptions): Promise<Blob>;
  getCRS?(): string;
  reproject?(targetCrs: string): Promise<void>;
}
