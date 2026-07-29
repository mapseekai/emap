import type { EditCommand } from '../edit-command';
import {
  isPathLayer,
  type ArcVertexData,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import {
  SplitSharedArcsCommand,
  type AppendedArc,
  type SplitSharedArcsCommandOptions,
} from './split-shared-arcs';

export interface SplitSharedNodePlan extends SplitSharedArcsCommandOptions {
  detachedVertexIds: number[];
}

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

export function planSharedNodeSplit(
  source: TopologySource,
  layer: MapshaperLayer,
  featureId: number,
  vertexId: number,
  allLayers: MapshaperLayer[],
): SplitSharedNodePlan | null {
  const arcs = source.getArcs();
  const data = arcs?.getVertexData?.();
  const shape = layer.shapes?.[featureId];
  if (!arcs || !data || !shape || !isPathLayer(layer)) return null;
  if (vertexId < 0 || vertexId >= data.xx.length) return null;

  const targetX = data.xx[vertexId];
  const targetY = data.yy[vertexId];
  const incidentArcIds: number[] = [];
  const seenIncident = new Set<number>();

  for (const part of shape as PathShape) {
    for (const rawArcId of part) {
      const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
      if (seenIncident.has(arcId) || !arcContainsCoordinate(arcId, targetX, targetY, data)) {
        continue;
      }
      seenIncident.add(arcId);
      incidentArcIds.push(arcId);
    }
  }
  if (incidentArcIds.length === 0) return null;

  const referencedElsewhere = new Uint8Array(arcs.size());
  let coordinateReferencedElsewhere = false;
  for (const candidateLayer of allLayers) {
    if (!candidateLayer.shapes || !isPathLayer(candidateLayer)) continue;
    for (let candidateId = 0; candidateId < candidateLayer.shapes.length; candidateId++) {
      if (candidateLayer === layer && candidateId === featureId) continue;
      const candidateShape = candidateLayer.shapes[candidateId] as PathShape | null;
      if (!candidateShape) continue;
      for (const part of candidateShape as PathShape) {
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

  const originalShape = (shape as PathShape).map((part) => part.slice());
  const newShape: PathShape = originalShape.map((part) =>
    part.map((rawArcId) => {
      const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
      const replacement = oldToNew.get(arcId);
      if (replacement === undefined) return rawArcId;
      return rawArcId >= 0 ? replacement : ~replacement;
    }),
  );

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
    remaps: [{ layer, featureId, originalShape, newShape }],
    appendedArcs,
    originalArcCount,
    detachedVertexIds,
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
