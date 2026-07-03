import { EventDispatcher } from '../core/events';
import type { ArcCollection, MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { DisplayArcs } from './display-arcs';
import type { Bounds } from '../geo/bounds';

export interface Source extends EventDispatcher {
  id: string;
  type: 'topology' | 'geojson';
  getExtent(): Bounds;
}

/**
 * File formats emap can serialize a dataset to. Mirrors the import format
 * set. `geoparquet` / `geoarrow` require the optional formats module
 * (`@zwishing/emap/formats`) to be imported first.
 */
export type ExportFormat = 'geojson' | 'topojson' | 'shapefile' | 'msx' | 'geoparquet' | 'geoarrow';

/** Options for {@link TopologySource.export}. */
export interface ExportOptions {
  format: ExportFormat;
  /**
   * Geometry encoding for `geoparquet` / `geoarrow` output.
   * Defaults: `'wkb'` for geoparquet (max interop — DuckDB, GeoPandas, GDAL),
   * `'native'` (GeoArrow nested coordinate arrays) for geoarrow.
   */
  encoding?: 'wkb' | 'native';
  /**
   * Layer to export for single-layer formats (`geoparquet` / `geoarrow`).
   * Index or layer name; defaults to layer 0.
   */
  layer?: number | string;
  /**
   * Reproject to WGS84 (EPSG:4326) before writing `geoparquet` / `geoarrow`
   * output. Content-affecting: setting this (even to `false`) forces a fresh
   * table rebuild instead of reusing a cached Arrow table, since a cached
   * table cannot retroactively honor a reprojection request.
   */
  reprojectToWgs84?: boolean;
  /**
   * Name of the bbox covering column to add for `geoparquet` output, or
   * `false` to omit it. Content-affecting — see {@link reprojectToWgs84}.
   */
  bboxColumn?: string | false;
  /**
   * Name of the geometry column in `geoparquet` / `geoarrow` output.
   * Content-affecting — see {@link reprojectToWgs84}.
   */
  geometryColumn?: string;
}

export interface TopologySource extends Source {
  type: 'topology';
  getArcs(): ArcCollection | undefined;
  getLayers(): MapshaperLayer[];
  /**
   * Returns the live mapshaper dataset reference owned by this source.
   *
   * **Do not mutate the returned object directly**. Edit-history caches
   * (arc-flag flags, Flatbush spatial indices, the LOD copy in DisplayArcs)
   * key off `(layer, shape, arc)` identity and shape/arc counts; mutations
   * applied outside the official edit-command surface will silently desync
   * those caches. To change a dataset, route the change through
   * `Emap.ops.*` (clip / dissolve / buffer / …), `Emap.editSession.*`
   * (translate / rotate / scale), or a custom `EditCommand`. Read-only
   * inspection — `getDataset()?.info?.crs_string`, `dataset.layers[0].name`,
   * arc iteration via `dataset.arcs.getArcIter()` — is always safe.
   *
   * The TypeScript return type intentionally stays `MapshaperDataset` (not
   * `Readonly<MapshaperDataset>`) because mapshaper's own internal helpers
   * — and a number of in-tree edit commands — receive the dataset and
   * mutate it through trusted code paths. A blanket `Readonly` would just
   * force casts everywhere.
   */
  getDataset(): MapshaperDataset | undefined;
  getDisplayArcs(): DisplayArcs | null;
  /**
   * Monotonic render-data revision. Increments whenever derived renderer
   * artifacts built from this source's topology should be considered stale.
   */
  getRenderRevision(): number;
  /** Monotonic counter of committed data changes. See TopologySource docs. */
  getDataRevision(): number;
  /** Record an in-place data edit; expires derived caches lazily. */
  markDataEdited(): void;
  /**
   * Eagerly re-initialize the LOD copy in DisplayArcs from the current
   * dataset arcs. Use for one-shot mutations that need the new copy ready
   * immediately. Per-frame in-place edits (drag sessions) should prefer
   * {@link markDisplayArcsDirty} to defer the rebuild until the renderer
   * actually needs the filtered copy.
   */
  refreshDisplayArcs(): void;
  /**
   * Mark the LOD copy stale; the next `getScaledArcs` rebuilds it lazily.
   * O(1); safe inside per-frame drag callbacks.
   */
  markDisplayArcsDirty?(): void;
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
  reproject?(targetCrs: string, targetCrsMetadata?: string): Promise<void>;
  /**
   * GeoArrow table for one layer of the current dataset. Cached per
   * (layer, encoding); rebuilt lazily when the data revision moved.
   * Returns `unknown` because the core bundle must not depend on
   * apache-arrow types — callers cast to `Table`. Throws if the optional
   * formats module (`@zwishing/emap/formats`) has not been imported.
   */
  getArrowTable(opts?: GetArrowTableOptions): unknown;
  /**
   * Install an externally produced table as the cache entry for the current
   * data revision (e.g. import path, DuckDB result tables) so it doesn't get
   * re-converted on the next {@link getArrowTable} call.
   *
   * `forDataset`, when provided, guards against a race where a concurrent
   * op replaced the dataset between the caller computing `table` and this
   * call landing: if `forDataset` no longer matches the source's current
   * dataset, the seed is dropped as a no-op.
   */
  seedArrowTable(
    table: unknown,
    opts: { encoding: 'native' | 'wkb'; layer?: number | string; forDataset?: MapshaperDataset },
  ): void;
}

/** Options for {@link TopologySource.getArrowTable}. */
export interface GetArrowTableOptions {
  /** Layer to convert (index or name); defaults to layer 0. */
  layer?: number | string;
  /** 'native' (GeoArrow nested arrays; rendering/export default), 'wkb' (DuckDB). */
  encoding?: 'native' | 'wkb';
}
