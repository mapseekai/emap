import { EventDispatcher } from '../../core/events';
import { FeatureQuery } from '../../map/feature-query';
import type {
  ArcCollection,
  MapshaperLayer,
  PathShape,
} from '../../../shared/types/mapshaper-types';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface Dependencies {
  document: Pick<WorkspaceDocument, '_sources'>;
  events: EventDispatcher;
  view: Pick<ViewServiceImpl, '_viewport'>;
}

/** cache implementation, wired through explicit service dependencies. */
export class WorkspaceCache {
  _layerArcIdsCache: globalThis.Map<string, globalThis.Map<MapshaperLayer, Uint32Array>> =
    new globalThis.Map<string, Map<MapshaperLayer, Uint32Array<ArrayBufferLike>>>();

  _featureQuery!: FeatureQuery;

  _getLayerArcIds(sourceId: string, ml: MapshaperLayer, arcs: ArcCollection): Uint32Array | null {
    if (!ml.shapes) return null;

    const sourceCache = this._layerArcIdsCache.get(sourceId);
    const cached = sourceCache?.get(ml);
    if (cached) return cached;

    const seen = new Uint8Array(arcs.size());
    const ids: number[] = [];
    for (const shape of ml.shapes as Array<PathShape | null>) {
      if (!shape) continue;
      for (const part of shape) {
        for (const signedArcId of part) {
          const arcId = signedArcId >= 0 ? signedArcId : ~signedArcId;
          if (seen[arcId] === 1) continue;
          seen[arcId] = 1;
          ids.push(arcId);
        }
      }
    }

    const arcIds = Uint32Array.from(ids);
    const layerCache = sourceCache ?? new globalThis.Map<MapshaperLayer, Uint32Array>();
    layerCache.set(ml, arcIds);
    this._layerArcIdsCache.set(sourceId, layerCache);
    return arcIds;
  }

  public prebuildSpatialIndex(sourceId?: string): void {
    this._featureQuery.prebuild(sourceId);
  }

  public clearSpatialIndex(sourceId?: string): void {
    this._featureQuery.clear(sourceId);
    this.deps.events.fire('rendercacheclear', { sourceId });
  }

  _clearSpatialIndexesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      this._featureQuery?.clear(sourceId);
    }
  }

  _invalidateShapeCachesForSources(sourceIds: Iterable<string>): void {
    for (const sourceId of sourceIds) {
      this._layerArcIdsCache.delete(sourceId);
      this._featureQuery?.clear(sourceId);
    }
  }

  _invalidateAllShapeCaches(): void {
    this._layerArcIdsCache.clear();
    for (const id of this.deps.document._sources.keys()) this._featureQuery?.clear(id);
  }

  dispose(): void {
    for (const id of this.deps.document._sources.keys()) this._featureQuery.clear(id);
    this._layerArcIdsCache.clear();
  }

  constructor(private readonly deps: Dependencies) {
    this._featureQuery = new FeatureQuery(
      this.deps.document._sources,
      () => this.deps.view._viewport.transform,
      () => ({ width: this.deps.view._viewport.width, height: this.deps.view._viewport.height }),
      () => this.deps.view._viewport.initialMX,
      () => this.deps.view._viewport.geometryLodTolerance,
    );
  }
}
