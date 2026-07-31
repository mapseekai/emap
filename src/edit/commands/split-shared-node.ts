import type { EditCommand } from '../edit-command';
import {
  isPathLayer,
  type ArcCollection,
  type ArcVertexData,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import {
  SplitSharedArcsCommand,
  type AppendedArc,
  type SplitSharedArcsCommandOptions,
} from './split-shared-arcs';

/**
 * Precomputed topology changes required to detach one shared path node.
 *
 * In addition to the duplicated arcs and shape remaps consumed by
 * {@link SplitSharedArcsCommand}, the plan records every vertex id that must
 * move together after the split.
 */
export interface SplitSharedNodePlan extends SplitSharedArcsCommandOptions {
  /** Vertex ids in the post-split arc collection that represent the detached node. */
  detachedVertexIds: number[];
}

/**
 * Undoable command that applies a {@link SplitSharedNodePlan}.
 *
 * Executing the command duplicates topology shared with other features;
 * undo restores the original arc collection and feature shapes.
 */
export class SplitSharedNodeCommand implements EditCommand {
  readonly label = 'Split shared node';
  private readonly _delegate: SplitSharedArcsCommand;

  constructor(readonly plan: SplitSharedNodePlan) {
    this._delegate = new SplitSharedArcsCommand(plan);
  }

  do(): void {
    this._delegate.do();
  }

  undo(): void {
    this._delegate.undo();
  }
}

/**
 * Builds the topology rewrite needed to detach a vertex from features that
 * share the same arcs or node coordinate.
 *
 * Returns `null` when the target is not a valid path vertex or is not shared.
 * The returned plan can be passed to {@link SplitSharedNodeCommand}; use its
 * `detachedVertexIds` when moving the newly independent node.
 *
 * @param source Required topology source that owns the target layer and arcs.
 * @param layer Required polygon or polyline layer containing the target feature.
 * @param featureId Required zero-based feature index within `layer.shapes`.
 * @param vertexId Required zero-based vertex index in the source arc collection.
 * @param allLayers Required complete layer list from `source`, used to detect sharing.
 */
export function planSharedNodeSplit(
  source: TopologySource,
  layer: MapshaperLayer,
  featureId: number,
  vertexId: number,
  allLayers: readonly MapshaperLayer[],
): SplitSharedNodePlan | null {
  const analysis = analyzeSharedNode(source, layer, featureId, vertexId, allLayers);
  if (!analysis) return null;
  const { arcs, data, shape, targetX, targetY, incidentArcIds, sharedArcIds } = analysis;

  const originalArcCount = arcs.size();
  const oldToNew = new globalThis.Map<number, number>();
  const appendedArcs: AppendedArc[] = [];
  for (let i = 0; i < sharedArcIds.length; i++) {
    const arcId = sharedArcIds[i];
    const start = data.ii[arcId];
    const length = data.nn[arcId];
    oldToNew.set(arcId, originalArcCount + i);
    appendedArcs.push({
      xx: new Float64Array(data.xx.subarray(start, start + length)),
      yy: new Float64Array(data.yy.subarray(start, start + length)),
      zz: data.zz ? new Float64Array(data.zz.subarray(start, start + length)) : null,
    });
  }

  const remaps: SplitSharedNodePlan['remaps'] = [];
  if (sharedArcIds.length > 0) {
    const originalShape = shape.map((part) => part.slice());
    const newShape: PathShape = originalShape.map((part) =>
      part.map((rawArcId) => {
        const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
        const replacement = oldToNew.get(arcId);
        if (replacement === undefined) return rawArcId;
        return rawArcId >= 0 ? replacement : ~replacement;
      }),
    );
    remaps.push({ layer, featureId, originalShape, newShape });
  }

  const detachedVertexIds: number[] = [];
  let appendedOffset = data.xx.length;
  for (const arcId of incidentArcIds) {
    const replacement = oldToNew.get(arcId);
    if (replacement === undefined) {
      collectCoordinateVertexIds(arcId, targetX, targetY, data, detachedVertexIds);
      continue;
    }
    const appended = appendedArcs[replacement - originalArcCount];
    for (let i = 0; i < appended.xx.length; i++) {
      if (appended.xx[i] === targetX && appended.yy[i] === targetY) {
        detachedVertexIds.push(appendedOffset + i);
      }
    }
    appendedOffset += appended.xx.length;
  }

  return {
    source,
    remaps,
    appendedArcs,
    originalArcCount,
    detachedVertexIds,
  };
}

export function isSharedNode(
  source: TopologySource,
  layer: MapshaperLayer,
  featureId: number,
  vertexId: number,
  allLayers: readonly MapshaperLayer[],
): boolean {
  return analyzeSharedNode(source, layer, featureId, vertexId, allLayers) !== null;
}

interface SharedNodeAnalysis {
  arcs: ArcCollection;
  data: ArcVertexData;
  shape: PathShape;
  targetX: number;
  targetY: number;
  incidentArcIds: number[];
  sharedArcIds: number[];
}

function analyzeSharedNode(
  source: TopologySource,
  layer: MapshaperLayer,
  featureId: number,
  vertexId: number,
  allLayers: readonly MapshaperLayer[],
): SharedNodeAnalysis | null {
  const mutableSource = asMutableTopologySource(source);
  const arcs = mutableSource.getArcs();
  const data = arcs?.getVertexData?.();
  const shape = layer.shapes?.[featureId];
  if (!arcs || !data || !shape || !isPathLayer(layer)) return null;
  if (vertexId < 0 || vertexId >= data.xx.length) return null;

  const targetX = data.xx[vertexId];
  const targetY = data.yy[vertexId];
  const incidentArcIds = collectAnchoredIncidentArcIds(
    shape as PathShape,
    vertexId,
    targetX,
    targetY,
    data,
    layer.geometry_type === 'polygon',
  );
  if (incidentArcIds.length === 0) return null;

  const referencedElsewhere = new Uint8Array(arcs.size());
  let coordinateReferencedElsewhere = false;
  for (const candidateLayer of allLayers) {
    if (!candidateLayer.shapes || !isPathLayer(candidateLayer)) continue;
    for (let candidateId = 0; candidateId < candidateLayer.shapes.length; candidateId++) {
      if (candidateLayer === layer && candidateId === featureId) continue;
      const candidateShape = candidateLayer.shapes[candidateId] as PathShape | null;
      if (!candidateShape) continue;
      for (const part of candidateShape) {
        for (const rawArcId of part) {
          const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
          if (arcId >= 0 && arcId < referencedElsewhere.length) referencedElsewhere[arcId] = 1;
          if (
            !coordinateReferencedElsewhere &&
            arcContainsCoordinate(arcId, targetX, targetY, data)
          ) {
            coordinateReferencedElsewhere = true;
          }
        }
      }
    }
  }

  const sharedArcIds = incidentArcIds.filter((arcId) => referencedElsewhere[arcId] === 1);
  if (sharedArcIds.length === 0 && !coordinateReferencedElsewhere) return null;
  return {
    arcs,
    data,
    shape: shape as PathShape,
    targetX,
    targetY,
    incidentArcIds,
    sharedArcIds,
  };
}

function arcContainsCoordinate(arcId: number, x: number, y: number, data: ArcVertexData): boolean {
  const start = data.ii[arcId];
  const end = start + data.nn[arcId];
  for (let vertexId = start; vertexId < end; vertexId++) {
    if (data.xx[vertexId] === x && data.yy[vertexId] === y) return true;
  }
  return false;
}

function collectCoordinateVertexIds(
  arcId: number,
  x: number,
  y: number,
  data: ArcVertexData,
  result: number[],
): void {
  const start = data.ii[arcId];
  const end = start + data.nn[arcId];
  for (let vertexId = start; vertexId < end; vertexId++) {
    if (data.xx[vertexId] === x && data.yy[vertexId] === y) result.push(vertexId);
  }
}

function collectAnchoredIncidentArcIds(
  shape: PathShape,
  vertexId: number,
  x: number,
  y: number,
  data: ArcVertexData,
  wrapParts: boolean,
): number[] {
  const anchorArcId = findArcIdForVertex(vertexId, data);
  if (anchorArcId < 0) return [];

  const incidentArcIds: number[] = [];
  const seen = new Set<number>();
  const addArc = (arcId: number): void => {
    if (seen.has(arcId)) return;
    seen.add(arcId);
    incidentArcIds.push(arcId);
  };
  const addConnectedArc = (part: number[], index: number, endpoint: 'start' | 'end'): void => {
    if (part.length === 0) return;
    if (index < 0 || index >= part.length) {
      if (!wrapParts) return;
      index = (index + part.length) % part.length;
    }
    const rawArcId = part[index];
    const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
    const start = data.ii[arcId];
    const end = start + data.nn[arcId] - 1;
    const endpointVertexId =
      endpoint === 'start' ? (rawArcId >= 0 ? start : end) : rawArcId >= 0 ? end : start;
    if (data.xx[endpointVertexId] === x && data.yy[endpointVertexId] === y) addArc(arcId);
  };

  for (const part of shape) {
    for (let index = 0; index < part.length; index++) {
      const rawArcId = part[index];
      const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
      if (arcId !== anchorArcId) continue;

      addArc(arcId);
      const start = data.ii[arcId];
      const end = start + data.nn[arcId] - 1;
      const traversalStart = rawArcId >= 0 ? start : end;
      const traversalEnd = rawArcId >= 0 ? end : start;
      if (vertexId === traversalStart) addConnectedArc(part, index - 1, 'end');
      if (vertexId === traversalEnd) addConnectedArc(part, index + 1, 'start');
    }
  }

  return incidentArcIds;
}

function findArcIdForVertex(vertexId: number, data: ArcVertexData): number {
  let low = 0;
  let high = data.ii.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = data.ii[mid];
    const end = start + data.nn[mid];
    if (vertexId < start) high = mid - 1;
    else if (vertexId >= end) low = mid + 1;
    else return mid;
  }
  return -1;
}
