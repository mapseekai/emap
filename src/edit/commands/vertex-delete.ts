import type { EditCommand } from '../edit-command';
import {
  bumpEditVersion,
  isPathLayer,
  type ArcCollection,
  type ArcVertexData,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import { asMutableTopologySource, type TopologySource } from '../../source/source';
import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { BulkFeatureDeleteCommand } from './feature-delete';
import { CompositeCommand } from './composite';
import {
  SplitSharedArcsCommand,
  type AppendedArc,
  type SplitSharedArcsRemap,
} from './split-shared-arcs';

export interface VertexDeleteCommandOptions {
  /** Global vertex index of the deleted vertex (recorded before deletion). */
  vertexIndex: number;
  /** Coordinate of the deleted vertex (recorded before deletion). */
  coords: [number, number];
  arcs: ArcCollection;
  source: TopologySource;
  /** Adapter override for tests; defaults to the process-wide singleton. */
  adapter?: MapshaperAdapter;
}

/**
 * Reverse a vertex deletion by re-inserting at the same global index. Pair
 * with `VertexInsertCommand`'s symmetry: this command's `do()` performs the
 * deletion (called only on redo), `undo()` restores the vertex.
 */
export class VertexDeleteCommand implements EditCommand {
  readonly label = 'Delete vertex';

  constructor(private readonly opts: VertexDeleteCommandOptions) {}

  do(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.deleteVertex(this.opts.arcs, this.opts.vertexIndex);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }

  undo(): void {
    const adapter = this.opts.adapter ?? getDefaultMapshaperAdapter();
    adapter.insertVertex(this.opts.arcs, this.opts.vertexIndex, this.opts.coords);
    asMutableTopologySource(this.opts.source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this.opts.source).getDataset?.());
  }
}

export interface TopologyNodeDeletion {
  command: EditCommand;
  deletedFeatureCount: number;
  shapeChanged: boolean;
}

interface DeletedVertex {
  index: number;
  arcId: number;
  x: number;
  y: number;
  z: number | null;
}

/**
 * Plan one topology-aware node deletion. Every supplied vertex id is removed
 * together, so a coordinate shared by several arcs remains topologically
 * consistent. Features that would contain an invalid path afterwards are
 * removed in the same undoable command.
 */
export function planTopologyNodeDeletion(
  source: TopologySource,
  vertexIds: readonly number[],
  allLayers: readonly MapshaperLayer[],
): TopologyNodeDeletion | null {
  const mutableSource = asMutableTopologySource(source);
  const arcs = mutableSource.getArcs();
  const data = arcs?.getVertexData?.();
  if (!arcs || !data || !arcs.updateVertexData) return null;

  const ids = [...new Set(vertexIds)]
    .filter((id) => Number.isInteger(id) && id >= 0 && id < data.xx.length)
    .sort((a, b) => a - b);
  if (ids.length === 0) return null;

  const deletedVertices: DeletedVertex[] = [];
  const affectedArcIds = new Set<number>();
  for (const index of ids) {
    const arcId = findArcIdForVertex(index, data);
    if (arcId < 0) continue;
    affectedArcIds.add(arcId);
    deletedVertices.push({
      index,
      arcId,
      x: data.xx[index],
      y: data.yy[index],
      z: data.zz?.[index] ?? null,
    });
  }
  if (deletedVertices.length === 0) return null;

  const deletedIdSet = new Set(deletedVertices.map((vertex) => vertex.index));
  const children: EditCommand[] = [
    new TopologyNodeDeleteCommand(source, arcs, data, deletedVertices),
  ];
  const bridges = planEndpointBridges(arcs.size(), allLayers, data, deletedIdSet);
  if (bridges.appendedArcs.length > 0) {
    children.push(
      new SplitSharedArcsCommand({
        source,
        remaps: bridges.remaps,
        appendedArcs: bridges.appendedArcs,
        originalArcCount: arcs.size(),
      }),
    );
  }
  let deletedFeatureCount = 0;

  for (const layer of allLayers) {
    if (!layer.shapes || !isPathLayer(layer)) continue;
    const snapshots: Array<{
      id: number;
      shape: PathShape;
      record: Record<string, unknown> | null;
    }> = [];
    const records = layer.data?.getRecords?.();
    const minimumVertexCount = layer.geometry_type === 'polygon' ? 3 : 2;

    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      let invalid = false;
      for (const part of shape) {
        if (!partUsesAnyArc(part, affectedArcIds)) continue;
        if (
          countRemainingPathVertices(part, data, deletedIdSet, layer.geometry_type === 'polygon') <
          minimumVertexCount
        ) {
          invalid = true;
          break;
        }
      }
      if (!invalid) continue;
      snapshots.push({
        id: featureId,
        shape,
        record: records?.[featureId] ?? null,
      });
    }

    if (snapshots.length > 0) {
      children.push(new BulkFeatureDeleteCommand({ layer, snapshots }));
      deletedFeatureCount += snapshots.length;
    }
  }

  return {
    command: new CompositeCommand(children, 'Delete topology node'),
    deletedFeatureCount,
    shapeChanged: bridges.remaps.length > 0 || deletedFeatureCount > 0,
  };
}

interface EndpointBridgePlan {
  appendedArcs: AppendedArc[];
  remaps: SplitSharedArcsRemap[];
}

type Coordinate = [number, number];

function planEndpointBridges(
  originalArcCount: number,
  allLayers: readonly MapshaperLayer[],
  data: ArcVertexData,
  deletedIds: ReadonlySet<number>,
): EndpointBridgePlan {
  const appendedArcs: AppendedArc[] = [];
  const remaps: SplitSharedArcsRemap[] = [];
  const bridgeArcIds = new Map<string, number>();

  const getBridgeArcId = (from: Coordinate, to: Coordinate): number => {
    const forward = from[0] < to[0] || (from[0] === to[0] && from[1] <= to[1]);
    const start = forward ? from : to;
    const end = forward ? to : from;
    const key = JSON.stringify([start[0], start[1], end[0], end[1]]);
    let arcId = bridgeArcIds.get(key);
    if (arcId === undefined) {
      arcId = originalArcCount + appendedArcs.length;
      bridgeArcIds.set(key, arcId);
      appendedArcs.push({
        xx: Float64Array.of(start[0], end[0]),
        yy: Float64Array.of(start[1], end[1]),
        zz: data.zz ? Float64Array.of(Infinity, Infinity) : null,
      });
    }
    return forward ? arcId : ~arcId;
  };

  for (const layer of allLayers) {
    if (!layer.shapes || !isPathLayer(layer)) continue;
    const wrap = layer.geometry_type === 'polygon';
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape) continue;
      let touched = false;
      const newShape: PathShape = shape.map((part) => {
        if (part.length === 0) return [];
        const bridgeAfter = new Array<number | null>(part.length).fill(null);
        const pairCount = wrap ? part.length : part.length - 1;
        for (let index = 0; index < pairCount; index++) {
          const nextIndex = (index + 1) % part.length;
          const currentArcId = part[index];
          const nextArcId = part[nextIndex];
          const currentLength = data.nn[currentArcId >= 0 ? currentArcId : ~currentArcId];
          const currentEndId = traversalVertexId(currentArcId, currentLength - 1, data);
          const nextStartId = traversalVertexId(nextArcId, 0, data);
          if (!deletedIds.has(currentEndId) || !deletedIds.has(nextStartId)) continue;

          const from = findRemainingArcEndpoint(currentArcId, data, deletedIds, false);
          const to = findRemainingArcEndpoint(nextArcId, data, deletedIds, true);
          if (!from || !to || (from[0] === to[0] && from[1] === to[1])) continue;
          bridgeAfter[index] = getBridgeArcId(from, to);
          touched = true;
        }

        if (!bridgeAfter.some((arcId) => arcId !== null)) return part.slice();
        const newPart: number[] = [];
        for (let index = 0; index < part.length; index++) {
          newPart.push(part[index]);
          const bridgeArcId = bridgeAfter[index];
          if (bridgeArcId !== null) newPart.push(bridgeArcId);
        }
        return newPart;
      });

      if (touched) {
        remaps.push({
          layer,
          featureId,
          originalShape: shape.map((part) => part.slice()),
          newShape,
        });
      }
    }
  }

  return { appendedArcs, remaps };
}

function traversalVertexId(rawArcId: number, traversalIndex: number, data: ArcVertexData): number {
  const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
  const start = data.ii[arcId];
  const length = data.nn[arcId];
  return rawArcId >= 0 ? start + traversalIndex : start + length - 1 - traversalIndex;
}

function findRemainingArcEndpoint(
  rawArcId: number,
  data: ArcVertexData,
  deletedIds: ReadonlySet<number>,
  fromStart: boolean,
): Coordinate | null {
  const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
  const length = data.nn[arcId];
  for (let offset = 0; offset < length; offset++) {
    const traversalIndex = fromStart ? offset : length - 1 - offset;
    const vertexId = traversalVertexId(rawArcId, traversalIndex, data);
    if (!deletedIds.has(vertexId)) return [data.xx[vertexId], data.yy[vertexId]];
  }
  return null;
}

class TopologyNodeDeleteCommand implements EditCommand {
  readonly label = 'Delete topology node vertices';
  private readonly _originalNn: Int32Array;
  private readonly _originalPointCount: number;
  private readonly _hadZ: boolean;

  constructor(
    private readonly _source: TopologySource,
    private readonly _arcs: ArcCollection,
    data: ArcVertexData,
    private readonly _deleted: readonly DeletedVertex[],
  ) {
    this._originalNn = new Int32Array(data.nn);
    this._originalPointCount = data.xx.length;
    this._hadZ = data.zz !== null;
  }

  do(): void {
    const data = this._arcs.getVertexData?.();
    if (!data) return;
    const deletedIds = new Set(this._deleted.map((vertex) => vertex.index));
    const newXx = new Float64Array(data.xx.length - deletedIds.size);
    const newYy = new Float64Array(data.yy.length - deletedIds.size);
    const newZz = data.zz ? new Float64Array(data.zz.length - deletedIds.size) : null;
    let cursor = 0;
    for (let index = 0; index < data.xx.length; index++) {
      if (deletedIds.has(index)) continue;
      newXx[cursor] = data.xx[index];
      newYy[cursor] = data.yy[index];
      if (newZz && data.zz) newZz[cursor] = data.zz[index];
      cursor++;
    }

    const newNn = new Int32Array(this._originalNn);
    for (const vertex of this._deleted) newNn[vertex.arcId]--;
    updateVertexData(this._arcs, newNn, newXx, newYy, newZz);
    this._markChanged();
  }

  undo(): void {
    const data = this._arcs.getVertexData?.();
    if (!data) return;
    const deletedByIndex = new Map(this._deleted.map((vertex) => [vertex.index, vertex]));
    const restoredXx = new Float64Array(this._originalPointCount);
    const restoredYy = new Float64Array(this._originalPointCount);
    const restoredZz = this._hadZ ? new Float64Array(this._originalPointCount) : null;
    let cursor = 0;
    for (let index = 0; index < this._originalPointCount; index++) {
      const deleted = deletedByIndex.get(index);
      if (deleted) {
        restoredXx[index] = deleted.x;
        restoredYy[index] = deleted.y;
        if (restoredZz) restoredZz[index] = deleted.z ?? 0;
        continue;
      }
      restoredXx[index] = data.xx[cursor];
      restoredYy[index] = data.yy[cursor];
      if (restoredZz && data.zz) restoredZz[index] = data.zz[cursor];
      cursor++;
    }

    updateVertexData(
      this._arcs,
      new Int32Array(this._originalNn),
      restoredXx,
      restoredYy,
      restoredZz,
    );
    this._markChanged();
  }

  private _markChanged(): void {
    asMutableTopologySource(this._source).markDisplayArcsDirty?.();
    bumpEditVersion(asMutableTopologySource(this._source).getDataset?.());
  }
}

function updateVertexData(
  arcs: ArcCollection,
  nn: Int32Array,
  xx: Float64Array,
  yy: Float64Array,
  zz: Float64Array | null,
): void {
  const retainedInterval = arcs.getRetainedInterval?.();
  arcs.updateVertexData?.(nn, xx, yy, zz);
  if (retainedInterval !== undefined) arcs.setRetainedInterval?.(retainedInterval);
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

function partUsesAnyArc(part: readonly number[], arcIds: ReadonlySet<number>): boolean {
  for (const rawArcId of part) {
    const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
    if (arcIds.has(arcId)) return true;
  }
  return false;
}

function countRemainingPathVertices(
  part: readonly number[],
  data: ArcVertexData,
  deletedIds: ReadonlySet<number>,
  closed: boolean,
): number {
  let count = 0;
  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;

  for (const rawArcId of part) {
    const arcId = rawArcId >= 0 ? rawArcId : ~rawArcId;
    if (arcId < 0 || arcId >= data.nn.length) continue;
    const start = data.ii[arcId];
    const length = data.nn[arcId];
    for (let offset = 0; offset < length; offset++) {
      const vertexId = rawArcId >= 0 ? start + offset : start + length - 1 - offset;
      if (deletedIds.has(vertexId)) continue;
      const x = data.xx[vertexId];
      const y = data.yy[vertexId];
      if (count > 0 && x === lastX && y === lastY) continue;
      if (count === 0) {
        firstX = x;
        firstY = y;
      }
      lastX = x;
      lastY = y;
      count++;
    }
  }

  if (closed && count > 1 && firstX === lastX && firstY === lastY) count--;
  return count;
}
