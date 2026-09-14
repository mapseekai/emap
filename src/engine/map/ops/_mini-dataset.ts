import { type AppendedArc, type MapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type {
  ArcCollection,
  MapshaperDataset,
  PathLayer,
  PathShape,
} from '../../../shared/types/mapshaper-types';
import { isPathLayer } from '../../../shared/types/mapshaper-types';
import { unsignedArcId } from './geometry-2d';

export interface FeatureAt {
  layerIndex: number;
  featureId: number;
}

export interface MiniDataset {
  /** Scratch dataset: mini arcs + live-aligned candidate-only layers + trailing sentinel layer. */
  dataset: MapshaperDataset;
  /** Same object as dataset.arcs — convenience. */
  arcs: ArcCollection;
  /** miniArcId → liveArcId for every arc present at build time (provenance). */
  miniToLiveArc: readonly number[];
  /** Echo of the input candidates (layerIndex → featureIds). */
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  /** liveArcId → every live feature referencing it (copied arcs only; for splice translation). */
  referencers: ReadonlyMap<number, readonly FeatureAt[]>;
  /** Index of the sentinel layer in dataset.layers (= live layers.length). */
  sentinelLayerIndex: number;
}

/**
 * Materialize the currently retained geometry before legacy algorithms use
 * visible-segment indexes as raw vertex indexes.
 */
export function materializeRetainedMiniArcs(mini: MiniDataset): void {
  const retainedInterval = mini.arcs.getRetainedInterval?.() ?? 0;
  if (retainedInterval <= 0) return;
  const filteredArcs = mini.arcs.getFilteredCopy?.();
  if (!filteredArcs) {
    throw new Error('Direct geometry editing requires filtered ArcCollection copy support');
  }
  filteredArcs.setRetainedInterval?.(retainedInterval);
  mini.arcs = filteredArcs;
  mini.dataset.arcs = filteredArcs;
}

function validateArcId(arcId: number, arcCount: number, label: string): number {
  if (!Number.isInteger(arcId)) throw new Error(`${label} ${arcId} must be an integer`);
  const unsignedId = unsignedArcId(arcId);
  if (unsignedId >= arcCount) throw new Error(`${label} ${arcId} is out of range`);
  return unsignedId;
}

/** Copy arc coordinates out of a live ArcCollection as an AppendedArc. */
export function snapshotLiveArc(arcs: ArcCollection, arcId: number): AppendedArc {
  const data = arcs.getVertexData!();
  const liveArcId = validateArcId(arcId, arcs.size(), 'snapshotLiveArc: arc id');
  const start = data.ii[liveArcId]!;
  const end = start + data.nn[liveArcId]!;
  return {
    xx: data.xx.slice(start, end),
    yy: data.yy.slice(start, end),
    zz: data.zz ? data.zz.slice(start, end) : null,
  };
}

export function buildMiniDataset(opts: {
  dataset: MapshaperDataset;
  candidates: ReadonlyMap<number, ReadonlySet<number>>;
  adapter: MapshaperAdapter;
}): MiniDataset {
  const { dataset, candidates, adapter } = opts;
  const liveArcs = dataset.arcs;
  if (!liveArcs) throw new Error('buildMiniDataset requires path geometry');

  const arcCount = liveArcs.size();
  const liveIds = new Set<number>();
  for (const [layerIndex, ids] of candidates) {
    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= dataset.layers.length) {
      throw new Error(`buildMiniDataset: candidate layer index ${layerIndex} is out of range`);
    }
    const layer = dataset.layers[layerIndex]!;
    if (!isPathLayer(layer) || !layer.shapes) {
      throw new Error(
        `buildMiniDataset: candidate layer ${layerIndex} must be a shaped path layer`,
      );
    }
    for (const featureId of ids) {
      if (!Number.isInteger(featureId) || featureId < 0 || featureId >= layer.shapes.length) {
        throw new Error(
          `buildMiniDataset: candidate feature id ${featureId} is out of range for layer ${layerIndex}`,
        );
      }
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      for (const part of shape) {
        for (const ref of part) {
          liveIds.add(validateArcId(ref, arcCount, 'buildMiniDataset: arc reference'));
        }
      }
    }
  }
  const sorted = [...liveIds].sort((a, b) => a - b);
  const liveToMini = new Map<number, number>();
  const copies: AppendedArc[] = [];
  sorted.forEach((liveId, miniId) => {
    liveToMini.set(liveId, miniId);
    copies.push(snapshotLiveArc(liveArcs, liveId));
  });
  const arcs = adapter.createArcCollection(copies);
  const retainedInterval = liveArcs.getRetainedInterval?.();
  if (retainedInterval !== undefined) arcs.setRetainedInterval?.(retainedInterval);

  const referencers = new Map<number, FeatureAt[]>();
  for (const liveId of sorted) referencers.set(liveId, []);
  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex];
    if (!isPathLayer(layer) || !layer.shapes) continue;
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      const seen = new Set<number>();
      for (const part of shape) {
        for (const ref of part) {
          seen.add(validateArcId(ref, arcCount, 'buildMiniDataset: arc reference'));
        }
      }
      for (const liveId of seen) {
        referencers.get(liveId)?.push({ layerIndex, featureId });
      }
    }
  }

  const layers = dataset.layers.map((layer, layerIndex) => {
    if (!isPathLayer(layer) || !layer.shapes) return layer;
    const ids = candidates.get(layerIndex);
    const shapes: (PathShape | null)[] = new Array(layer.shapes.length).fill(null);
    if (ids) {
      for (const featureId of ids) {
        const shape = layer.shapes[featureId] as PathShape | null;
        if (!shape) continue;
        shapes[featureId] = shape.map((part) =>
          part.map((ref) => {
            const miniId = liveToMini.get(unsignedArcId(ref))!;
            return ref < 0 ? -miniId - 1 : miniId;
          }),
        );
      }
    }
    return { ...layer, shapes, data: undefined };
  });

  const sentinelLayerIndex = layers.length;
  const sentinelLayer = {
    geometry_type: 'polyline',
    shapes: sorted.map((_, miniId) => [[miniId]]),
  } as unknown as PathLayer;

  return {
    dataset: { ...dataset, arcs, layers: [...layers, sentinelLayer] },
    arcs,
    miniToLiveArc: sorted,
    candidates,
    referencers,
    sentinelLayerIndex,
  };
}
