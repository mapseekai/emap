import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { PathGeometryPatchCommand } from '../../edit/commands/path-geometry-patch';
import type { MutableTopologySource } from '../../source/source';
import type { Selection, SelectionDiff } from '../selection';
import type {
  ArcCollection,
  MapshaperDataset,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import { isPathLayer } from '../../types/mapshaper-types';
import { CONTACT_EPSILON, normalizeConsecutiveCoordinates, type Coordinate } from './geometry-2d';
import { buildMiniDataset } from './_mini-dataset';
import { translateMiniDataset } from './_mini-translate';
import { reshapeSelectedPolylines } from './reshape-selected-line';
import { reshapeSelectedPolygon } from './reshape-selected-polygon';
import { validatePolylineFeatureShape } from './reshape-selected';
import { SplitGeometryValidationError } from './split-selected-error';

type ReshapeBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

/** Contact-tolerance margin scaled by coordinate magnitude and extent. */
function boundsContactMargin(minX: number, minY: number, maxX: number, maxY: number): number {
  return (
    CONTACT_EPSILON *
    Math.max(
      1,
      Math.abs(minX),
      Math.abs(minY),
      Math.abs(maxX),
      Math.abs(maxY),
      maxX - minX,
      maxY - minY,
    )
  );
}

/** Bounding box of the drawn line, expanded by legacy contact tolerance. */
export function reshapeLineBounds(line: readonly Coordinate[]): ReshapeBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of line) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const margin = boundsContactMargin(minX, minY, maxX, maxY);
  return {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  };
}

function overlapsBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  bounds: ReshapeBounds,
): boolean {
  return maxX >= bounds.minX && minX <= bounds.maxX && maxY >= bounds.minY && minY <= bounds.maxY;
}

function arcIntersectsBounds(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  bounds: ReshapeBounds,
): boolean {
  const margin = boundsContactMargin(minX, minY, maxX, maxY);
  return overlapsBounds(minX - margin, minY - margin, maxX + margin, maxY + margin, bounds);
}

/** True when any referenced arc's bounding box could contact the drawn line. */
export function shapeIntersectsBounds(
  shape: PathShape,
  arcs: ArcCollection,
  bounds: ReshapeBounds,
): boolean {
  const data = arcs.getVertexData!();
  for (const part of shape) {
    for (const ref of part) {
      const arcId = ref < 0 ? -ref - 1 : ref;
      if (!Number.isSafeInteger(ref) || arcId < 0 || arcId >= arcs.size()) continue;
      if (data.bb) {
        const offset = arcId * 4;
        if (
          arcIntersectsBounds(
            data.bb[offset]!,
            data.bb[offset + 1]!,
            data.bb[offset + 2]!,
            data.bb[offset + 3]!,
            bounds,
          )
        ) {
          return true;
        }
        continue;
      }

      // Arc bounds may be absent on structural/test collections. Scan the
      // complete arc, then overlap its extent: endpoints can both be outside
      // the drawn-line bounds while their segment crosses it.
      const start = data.ii[arcId]!;
      const end = start + data.nn[arcId]!;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let vertexId = start; vertexId < end; vertexId++) {
        const x = data.xx[vertexId]!;
        const y = data.yy[vertexId]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (arcIntersectsBounds(minX, minY, maxX, maxY, bounds)) return true;
    }
  }
  return false;
}

export function planReshapeSource(opts: {
  source: MutableTopologySource;
  sourceId: string;
  dataset: MapshaperDataset;
  line: readonly Coordinate[];
  adapter: MapshaperAdapter;
  selection: Selection;
  publishSelection: (diff: SelectionDiff) => void;
}): { command: PathGeometryPatchCommand; reshapedCount: number } | 'invalid' | null {
  const { source, dataset, adapter, selection, publishSelection } = opts;
  const line = normalizeConsecutiveCoordinates(opts.line);
  const arcs = dataset.arcs;
  if (!arcs || line.length < 2) return null;
  const bounds = reshapeLineBounds(line);
  const candidates = new Map<number, Set<number>>();

  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex];
    if (
      !isPathLayer(layer) ||
      !layer.shapes ||
      (layer.geometry_type !== 'polygon' && layer.geometry_type !== 'polyline')
    ) {
      continue;
    }
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId] as PathShape | null;
      if (!shape || !shapeIntersectsBounds(shape, arcs, bounds)) continue;
      if (layer.geometry_type === 'polyline') {
        try {
          validatePolylineFeatureShape(shape, arcs);
        } catch (error) {
          if (error instanceof SplitGeometryValidationError) continue;
          throw error;
        }
      }
      let ids = candidates.get(layerIndex);
      if (!ids) {
        ids = new Set();
        candidates.set(layerIndex, ids);
      }
      ids.add(featureId);
    }
  }
  if (candidates.size === 0) return null;

  const mini = buildMiniDataset({ dataset, candidates, adapter });

  let reshapedPolygon = false;
  let reshapedCount = 0;
  try {
    for (const [layerIndex, featureIds] of candidates) {
      const liveLayer = dataset.layers[layerIndex] as PathLayer;
      const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
      if (liveLayer.geometry_type === 'polygon') {
        for (const featureId of featureIds) {
          let shape: PathShape | null = null;
          try {
            shape = reshapeSelectedPolygon(mini.dataset, layerIndex, featureId, line, adapter);
          } catch (error) {
            if (!(error instanceof SplitGeometryValidationError)) throw error;
          }
          if (!shape) continue;
          miniLayer.shapes![featureId] = shape;
          reshapedPolygon = true;
          reshapedCount += 1;
        }
      } else {
        const reshaped = reshapeSelectedPolylines(
          mini.dataset,
          layerIndex,
          featureIds,
          line,
          adapter,
        );
        for (const { featureId, shape } of reshaped) {
          miniLayer.shapes![featureId] = shape;
          reshapedCount += 1;
        }
      }
    }
  } catch (error) {
    if (error instanceof SplitGeometryValidationError) return 'invalid';
    throw error;
  }
  if (reshapedCount === 0) return null;
  if (reshapedPolygon)
    adapter.addIntersectionCuts(mini.dataset, { no_snap: true, rebuild_topology: true });

  const translation = translateMiniDataset({
    mini,
    liveDataset: dataset,
    liveArcCount: arcs.size(),
    liveLayers: dataset.layers,
  });
  if (!translation) return 'invalid';

  return {
    reshapedCount,
    command: new PathGeometryPatchCommand({
      source,
      shapePatches: translation.shapePatches,
      originalArcCount: arcs.size(),
      appendedArcs: translation.appendedArcs,
      selection,
      beforeSelection: selection.snapshot(),
      afterSelection: selection.getAll(),
      publishSelection,
      label: `Reshape ${reshapedCount} feature${reshapedCount === 1 ? '' : 's'}`,
      adapter,
    }),
  };
}
