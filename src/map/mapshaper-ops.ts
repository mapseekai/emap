// Mapshaper command facade. Each method is a 1-line delegation to a free
// function under `src/map/ops/<op>.ts`. The real work lives there; this
// file's only job is to keep the `emap.ops.<method>(...)` surface stable
// and to construct the shared `OpContext` exactly once per call.
//
// History: this used to be a 1700-line class with every op body inline.
// PR-7 moved each op out into its own file behind the `OpContext`
// indirection so each op is independently:
//   - reviewable in isolation
//   - unit-testable with a stub host + stub `runDatasetCommand`
//   - replaceable without touching the facade

import type { EmapHostInternal } from './emap-host';
import type { OpResult } from './op-result';
import type { OpContext } from './ops/_context';
import { _runDatasetCommand as _runDatasetCommandShared, _applyDatasetReplace } from './ops/_runner';
import type {
  ApplyExpressionOptions,
  BufferOptions,
  CleanOptions,
  CheckGeometryOptions,
  ClipEraseOptions,
  DivideOptions,
  DropLayerOptions,
  DissolveOptions,
  ExplodeOptions,
  FilterFieldsOptions,
  FilterOptions,
  GeometryCheckReport,
  InnerlinesOptions,
  IntersectionPointsLayerOptions,
  JoinTableOptions,
  LinesOptions,
  MergeLayersOptions,
  MosaicOptions,
  PointsOptions,
  PolygonsOptions,
  ProjectOptions,
  RebuildTopologyOptions,
  RenameFieldsOptions,
  RenameLayerOptions,
  SimplifyOptions,
  SnapOptions,
  SortFeaturesOptions,
  SplitLayerOptions,
  UniqueFeaturesOptions,
  UnionOptions,
} from './types';
import { clipLayer, eraseLayer } from './ops/clip-erase';
import { dissolveLayer, mergeSelected } from './ops/dissolve';
import { bufferLayer } from './ops/buffer';
import { applyExpression, filterFeatures } from './ops/each-filter';
import { explodeLayer } from './ops/explode';
import { innerlinesLayer } from './ops/innerlines';
import { snapLayer } from './ops/snap';
import { cleanLayer } from './ops/clean';
import { rebuildTopology } from './ops/rebuild-topology';
import { mosaicLayer } from './ops/mosaic';
import { unionLayers } from './ops/union';
import { divideLayer } from './ops/divide';
import { pointsLayer } from './ops/points';
import { linesLayer } from './ops/lines';
import { polygonsLayer } from './ops/polygons';
import { simplifyLayer } from './ops/simplify';
import { projectLayer } from './ops/project';
import { renameLayer } from './ops/rename-layer';
import { mergeLayers } from './ops/merge-layers';
import { splitLayer } from './ops/split-layer';
import { dropLayer } from './ops/drop-layer';
import { sortFeatures } from './ops/sort-features';
import { uniqueFeatures } from './ops/unique-features';
import { filterFields } from './ops/filter-fields';
import { renameFields } from './ops/rename-fields';
import { checkGeometry } from './ops/check-geometry';
import { intersectionPointsLayer } from './ops/intersection-points';
import { joinTable } from './ops/join-table';

/**
 * Mapshaper command manager. Owned by Emap and exposed as `emap.ops`.
 * Every method delegates straight to the corresponding free function
 * under `src/map/ops/`. Construction takes the host; the per-call
 * `OpContext` is rebuilt on each access of `_ctx` so test paths that
 * substitute the manager via `Object.create(MapshaperOps.prototype)`
 * still see a working context once they wire up the host.
 */
export class MapshaperOps {
  constructor(private _emap: EmapHostInternal) {}

  /**
   * Lazily-built `OpContext` handed to every op function. Recomputed
   * on every call so nothing captures a stale `this`.
   */
  private get _ctx(): OpContext {
    return {
      host: this._emap,
      runDatasetCommand: (sourceId, cmd, label, inputFiles) =>
        _runDatasetCommandShared(this._emap, sourceId, cmd, label, inputFiles),
      applyDatasetReplace: (sourceId, before, after, label) =>
        _applyDatasetReplace(this._emap, sourceId, before, after, label),
    };
  }

  // -- Whole-dataset CLI ops ---------------------------------------------

  clipLayer(opts: ClipEraseOptions): Promise<OpResult> { return clipLayer(this._ctx, opts); }
  eraseLayer(opts: ClipEraseOptions): Promise<OpResult> { return eraseLayer(this._ctx, opts); }
  dissolveLayer(opts: DissolveOptions): Promise<OpResult> { return dissolveLayer(this._ctx, opts); }
  bufferLayer(opts: BufferOptions): Promise<OpResult> { return bufferLayer(this._ctx, opts); }
  applyExpression(opts: ApplyExpressionOptions): Promise<OpResult> { return applyExpression(this._ctx, opts); }
  filterFeatures(opts: FilterOptions): Promise<OpResult> { return filterFeatures(this._ctx, opts); }
  explodeLayer(opts: ExplodeOptions): Promise<OpResult> { return explodeLayer(this._ctx, opts); }
  innerlinesLayer(opts: InnerlinesOptions): Promise<OpResult> { return innerlinesLayer(this._ctx, opts); }
  snapLayer(opts: SnapOptions): Promise<OpResult> { return snapLayer(this._ctx, opts); }
  cleanLayer(opts: CleanOptions): Promise<OpResult> { return cleanLayer(this._ctx, opts); }
  mosaicLayer(opts: MosaicOptions): Promise<OpResult> { return mosaicLayer(this._ctx, opts); }
  unionLayers(opts: UnionOptions): Promise<OpResult> { return unionLayers(this._ctx, opts); }
  divideLayer(opts: DivideOptions): Promise<OpResult> { return divideLayer(this._ctx, opts); }
  pointsLayer(opts: PointsOptions): Promise<OpResult> { return pointsLayer(this._ctx, opts); }
  linesLayer(opts: LinesOptions): Promise<OpResult> { return linesLayer(this._ctx, opts); }
  polygonsLayer(opts: PolygonsOptions): Promise<OpResult> { return polygonsLayer(this._ctx, opts); }
  simplifyLayer(opts: SimplifyOptions): Promise<OpResult> { return simplifyLayer(this._ctx, opts); }
  projectLayer(opts: ProjectOptions): Promise<OpResult> { return projectLayer(this._ctx, opts); }

  // -- Layer management --------------------------------------------------

  renameLayer(opts: RenameLayerOptions): Promise<OpResult> { return renameLayer(this._ctx, opts); }
  mergeLayers(opts: MergeLayersOptions): Promise<OpResult> { return mergeLayers(this._ctx, opts); }
  splitLayer(opts: SplitLayerOptions): Promise<OpResult> { return splitLayer(this._ctx, opts); }
  dropLayer(opts: DropLayerOptions): Promise<OpResult> { return dropLayer(this._ctx, opts); }

  // -- Feature data ------------------------------------------------------

  sortFeatures(opts: SortFeaturesOptions): Promise<OpResult> { return sortFeatures(this._ctx, opts); }
  uniqueFeatures(opts: UniqueFeaturesOptions): Promise<OpResult> { return uniqueFeatures(this._ctx, opts); }
  filterFields(opts: FilterFieldsOptions): Promise<OpResult> { return filterFields(this._ctx, opts); }
  renameFields(opts: RenameFieldsOptions): Promise<OpResult> { return renameFields(this._ctx, opts); }
  joinTable(opts: JoinTableOptions): Promise<OpResult> { return joinTable(this._ctx, opts); }

  // -- Topology repair / inspection -------------------------------------

  rebuildTopology(opts: RebuildTopologyOptions): Promise<OpResult> { return rebuildTopology(this._ctx, opts); }
  checkGeometry(opts: CheckGeometryOptions): Promise<OpResult<GeometryCheckReport>> { return checkGeometry(this._ctx, opts); }
  intersectionPointsLayer(opts: IntersectionPointsLayerOptions): Promise<OpResult> { return intersectionPointsLayer(this._ctx, opts); }

  // -- Selection-driven ops ---------------------------------------------

  mergeSelected(): Promise<OpResult> { return mergeSelected(this._ctx); }
}
