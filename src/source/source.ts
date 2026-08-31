import { EventDispatcher } from '../core/events';
import type {
  ArcCollection,
  MapshaperDataset,
  MapshaperLayer,
  ReadonlyArcCollection,
  ReadonlyMapshaperDataset,
  ReadonlyMapshaperLayer,
} from '../types/mapshaper-types';
import type { DisplayArcs } from './display-arcs';
import type { Bounds } from '../geo/bounds';

export interface Source extends EventDispatcher {
  id: string;
  type: 'topology' | 'geojson';
  getExtent(): Bounds;
}

/**
 * File formats emap can serialize a dataset to. KML is import-only and is
 * therefore absent from this union. `geoparquet` / `geoarrow` require the
 * optional Arrow module (`@mapseekai/emap/arrow`) to be imported first;
 * `flatgeobuf` requires a registered format plugin.
 */
export type ExportFormat =
  | 'geojson'
  | 'topojson'
  | 'shapefile'
  | 'msx'
  | 'geoparquet'
  | 'geoarrow'
  | 'flatgeobuf';

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
}

export interface TopologySource extends Source {
  type: 'topology';
  /** Query-only view of the source's live arc collection. */
  getArcs(): ReadonlyArcCollection | undefined;
  /** Deep read-only view of the source's live layers. */
  getLayers(): readonly ReadonlyMapshaperLayer[];
  /**
   * Returns a zero-copy, deep read-only TypeScript view of the live dataset.
   *
   * The view intentionally omits mutating ArcCollection methods and marks
   * nested layers, shapes, records and metadata as read-only. Route changes
   * through `Emap.ops.*`, `Emap.editSession.*` or an `EditCommand` so render
   * caches, selection and history stay synchronized.
   *
   * This is a compile-time boundary, not a runtime clone: JavaScript, `any`
   * and explicit type assertions can still bypass it.
   */
  getDataset(): ReadonlyMapshaperDataset | undefined;
  /**
   * Serialize the current in-memory dataset to a browser `Blob`.
   *
   * Always emits full-detail geometry; the source's render-time LOD interval
   * is restored before the promise resolves.
   *
   * Supported `format` values:
   *
   * - `geojson` — single-file `application/geo+json`
   * - `topojson` — single-file `application/json`
   * - `shapefile` — `.shp`, `.shx`, `.dbf`, and optional `.prj` files packed
   *   into one `application/zip` Blob
   * - `msx` — compact mapshaper snapshot as `application/octet-stream`
   * - `geoparquet` — requires importing `@mapseekai/emap/arrow`; returns
   *   `application/vnd.apache.parquet`
   * - `geoarrow` — requires importing `@mapseekai/emap/arrow`; returns
   *   `application/vnd.apache.arrow.file`
   * - `flatgeobuf` — requires a registered FlatGeobuf format plugin; returns
   *   `application/x-flatgeobuf`
   *
   * KML is import-only and cannot be exported.
   */
  export(options: ExportOptions): Promise<Blob>;
  getCRS?(): string;
}

/**
 * Topology source contract used by owners that can atomically replace a dataset.
 *
 * @example
 * async function replace(source: ReplaceableTopologySource, dataset: MapshaperDataset) {
 *   await source.replaceDataset(dataset);
 * }
 */
export interface ReplaceableTopologySource extends TopologySource {
  replaceDataset(dataset: MapshaperDataset): Promise<void>;
}

/** @internal Normalized dataset plus the last-moment assertion run before it commits. */
export interface NormalizedDatasetCommit {
  dataset: MapshaperDataset;
  /**
   * Executed by the source immediately before the normalized dataset becomes
   * observable. Throws when the owner state that authorized the
   * normalization (registration, active map CRS) no longer holds.
   */
  assertCommittable(): void;
}

/** @internal Pre-commit dataset normalization hook installed by the owning map. */
export type DatasetNormalizer = (
  dataset: MapshaperDataset,
) => Promise<MapshaperDataset | NormalizedDatasetCommit>;

/**
 * Trusted engine-only view of a source. Public package exports expose the
 * read-only TopologySource contract; internal edit paths narrow once at their
 * ownership boundary instead of scattering assertions across callers.
 */
export interface MutableTopologySource extends ReplaceableTopologySource {
  getArcs(): ArcCollection | undefined;
  getLayers(): MapshaperLayer[];
  getDataset(): MapshaperDataset | undefined;
  /** @internal */
  getDisplayArcs(): DisplayArcs | null;
  /** @internal */
  refreshDisplayArcs(): void;
  /** @internal */
  markDisplayArcsDirty?(): void;
  /** @internal */
  setDataset(dataset: MapshaperDataset, notify?: boolean): void;
  /** @internal Normalize imported datasets before they become observable. */
  setDatasetNormalizer(normalizer: DatasetNormalizer | null): void;
  /** @internal Prevent per-source CRS changes while registered with a map. */
  setManagedCRS(getCrs: (() => string) | null): void;
  /** @internal */
  getSimplifyFloor(): number;
  prepareReproject(targetCrs: string, targetCrsMetadata?: string): Promise<MapshaperDataset>;
  prepareReprojectDataset(
    dataset: MapshaperDataset,
    targetCrs: string,
    targetCrsMetadata?: string,
  ): Promise<MapshaperDataset>;
}

export function isMutableTopologySource(source: TopologySource): source is MutableTopologySource {
  // Public query views intentionally omit engine mutation hooks, so validate
  // the registration boundary before retaining the source as engine-owned.
  const candidate = source as unknown as Partial<MutableTopologySource>;
  return (
    typeof candidate.getDisplayArcs === 'function' &&
    typeof candidate.refreshDisplayArcs === 'function' &&
    typeof candidate.setDataset === 'function' &&
    typeof candidate.replaceDataset === 'function' &&
    typeof candidate.setDatasetNormalizer === 'function' &&
    typeof candidate.getSimplifyFloor === 'function' &&
    typeof candidate.prepareReproject === 'function' &&
    typeof candidate.prepareReprojectDataset === 'function' &&
    typeof candidate.setManagedCRS === 'function'
  );
}

export function asMutableTopologySource(source: TopologySource): MutableTopologySource {
  return source as MutableTopologySource;
}
