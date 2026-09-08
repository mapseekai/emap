import { getDefaultMapshaperAdapter, type MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import {
  isPathLayer,
  type MapshaperDataset,
  type ArcCollection,
  type MapshaperLayer,
  type PathShape,
} from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { AutoCompletePolygonOptions, AutoCompletePolygonResult } from '../types';
import { getLayerId } from '../../source/layer-utils';
import type { OpContext } from './_context';
import { SplitFeaturesCommand } from '../../edit/commands/split-features';
import { buildMiniDataset, materializeRetainedMiniArcs } from './_mini-dataset';
import { translateMiniDataset, translateShapeFromMini } from './_mini-translate';
import { reshapeLineBounds } from './_reshape-plan';
import {
  normalizeConsecutiveCoordinates,
  SegmentConflictIndex,
  unsignedArcId,
  type Coordinate,
} from './geometry-2d';

/** Append faces enclosed by a sketch and existing boundaries, without overlapping existing faces.
 * The first polygon layer that completes a face receives the new features; no selection is required.
 */
export async function autoCompletePolygon(
  ctx: OpContext,
  options: AutoCompletePolygonOptions,
): Promise<OpResult<AutoCompletePolygonResult>> {
  if (
    !Array.isArray(options.line) ||
    !options.line.every(
      (point) =>
        Array.isArray(point) &&
        point.length === 2 &&
        point.every((value) => typeof value === 'number' && Number.isFinite(value)),
    )
  )
    return Err.validation('line', 'line coordinates are invalid');
  const line = normalizeConsecutiveCoordinates(options.line);
  if (line.length < 2)
    return Err.validation('line', 'line needs at least two distinct coordinates');
  if (
    new SegmentConflictIndex(
      [line.slice(1).map((end, index) => [line[index]!, end])],
      false,
    ).hasConflict()
  )
    return Err.validation('line', 'line self-intersects');
  const adapter = getDefaultMapshaperAdapter();
  for (const [sourceId, source] of ctx.host._sources) {
    const dataset = source.getDataset();
    if (!dataset?.arcs || !dataset.layers.some((layer) => layer.geometry_type === 'polygon'))
      continue;
    const result = await ctx.runPreparedEditCommand<AutoCompletePolygonResult>(
      sourceId,
      'Auto-complete polygon',
      (original, mutableSource) => {
        const { candidates, region } = collectCandidates(original, line);
        if (candidates.size === 0)
          return Err.validation('line', 'line and existing boundaries do not enclose a new face');
        // A chain of boundaries can close a face beyond the local envelope.
        // Retry with all paths when the local mosaic cannot complete a face.
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt === 1) {
            for (let i = 0; i < original.layers.length; i++) {
              const layer = original.layers[i]!;
              if (!isPathLayer(layer) || !layer.shapes) continue;
              candidates.set(i, new Set(layer.shapes.flatMap((shape, id) => (shape ? [id] : []))));
            }
          }
          const mini = buildMiniDataset({ dataset: original, candidates, adapter });
          materializeRetainedMiniArcs(mini);
          const working = mini.dataset;
          const arcs = working.arcs!;
          const sketchId = adapter.appendArc(arcs, line);
          const sketchLayer: MapshaperLayer = { geometry_type: 'polyline', shapes: [[[sketchId]]] };
          working.layers.push(sketchLayer);
          // Cut only the local scratch geometry; sentinels retain arc provenance
          // so shared boundaries can be spliced back into all live referencers.
          adapter.addIntersectionCuts(working, { no_snap: true, rebuild_topology: true });
          mini.arcs = working.arcs!;
          const sketchIds = new Set(
            (sketchLayer.shapes![0] as PathShape).flat().map(unsignedArcId),
          );
          working.layers.pop();
          for (let layerIndex = 0; layerIndex < original.layers.length; layerIndex++) {
            const layer = working.layers[layerIndex]!;
            if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
            const shapes = layer.shapes.filter((shape): shape is PathShape => !!shape?.length);
            if (shapes.length === 0) continue;
            const boundaryIds = new Set(shapes.flat(2).map(unsignedArcId));
            const tiles = adapter
              .buildPolygonMosaic(arcs, new Set([...boundaryIds, ...sketchIds]))
              .filter((tile) => {
                const ids = tile.flat().map(unsignedArcId);
                if (
                  !ids.some((id) => sketchIds.has(id) && !boundaryIds.has(id)) ||
                  !ids.some((id) => boundaryIds.has(id))
                )
                  return false;
                const anchor = adapter.getShapeAnchor(tile, arcs);
                return (
                  anchor !== null &&
                  adapter.getShapeArea(tile, arcs) > 0 &&
                  !shapes.some((shape) =>
                    adapter.testPointInPolygon(anchor[0], anchor[1], shape, arcs),
                  )
                );
              });
            const partial =
              (candidates.get(layerIndex)?.size ?? 0) < original.layers[layerIndex]!.shapes!.length;
            if (!tiles.length) {
              // Resolve earlier layers completely before considering later ones.
              if (attempt === 0 && partial) break;
              continue;
            }
            if (attempt === 0 && partial) {
              const bounds = arcs.getVertexData!().bb;
              const outside =
                !bounds ||
                tiles.some((tile) =>
                  tile.some((part) =>
                    part.some((ref) => {
                      const offset = unsignedArcId(ref) * 4;
                      return (
                        bounds[offset]! < region.minX ||
                        bounds[offset + 1]! < region.minY ||
                        bounds[offset + 2]! > region.maxX ||
                        bounds[offset + 3]! > region.maxY
                      );
                    }),
                  ),
                );
              if (
                outside ||
                hasUnenclosedSketch(arcs, sketchIds, boundaryIds, tiles, shapes, adapter)
              )
                break;
            }
            const translation = translateMiniDataset({
              mini,
              liveDataset: original,
              liveArcCount: original.arcs!.size(),
              liveLayers: original.layers,
              extraShapes: tiles,
            });
            if (!translation)
              return Err.validation('geometry', 'auto-complete result translation failed');
            const liveLayer = original.layers[layerIndex]!;
            const firstId = liveLayer.shapes!.length;
            const selection = ctx.host._selection;
            return {
              affectedSourceIds: [sourceId],
              value: {
                createdCount: tiles.length,
                features: tiles.map((_, index) => ({
                  source: sourceId,
                  layer: getLayerId(liveLayer, layerIndex),
                  id: firstId + index,
                })),
              },
              command: new SplitFeaturesCommand({
                source: mutableSource,
                shapePatches: translation.shapePatches,
                originalArcCount: original.arcs!.size(),
                appendedArcs: translation.appendedArcs,
                layer: liveLayer,
                originalFeatureCount: firstId,
                appendedShapes: tiles.map((tile) => translateShapeFromMini(translation, tile)),
                appendedRecords: tiles.map(() => ({})),
                selection,
                beforeSelection: selection.snapshot(),
                afterSelection: selection.getAll(),
                publishSelection: (diff) => ctx.host._fireSelectionChange(diff),
                label: 'Auto-complete polygon',
                adapter,
              }),
            };
          }
        }
        return Err.validation('line', 'line and existing boundaries do not enclose a new face');
      },
    );
    if (result.ok || result.error.kind !== 'validation') return result;
  }
  return Err.validation('line', 'line and existing boundaries do not enclose a new face');
}

/** Include entire contacted polygons and everything in the possible enclosed area.
 * Whole-shape bounds also retain containing faces and islands, even when none
 * of their boundary segments crosses the sketch's own bounding box.
 */
function collectCandidates(dataset: MapshaperDataset, line: readonly Coordinate[]) {
  const data = dataset.arcs!.getVertexData!();
  const sketchBounds = reshapeLineBounds(line);
  const region = { ...sketchBounds };
  const entries: { layerIndex: number; featureId: number; bounds: typeof region }[] = [];
  const overlaps = (a: typeof region, b: typeof region) =>
    a.maxX >= b.minX && a.minX <= b.maxX && a.maxY >= b.minY && a.minY <= b.maxY;
  let contacted = false;
  for (let layerIndex = 0; layerIndex < dataset.layers.length; layerIndex++) {
    const layer = dataset.layers[layerIndex]!;
    if (!isPathLayer(layer) || !layer.shapes) continue;
    for (let featureId = 0; featureId < layer.shapes.length; featureId++) {
      const shape = layer.shapes[featureId];
      if (!shape?.length) continue;
      const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const part of shape)
        for (const ref of part) {
          const id = unsignedArcId(ref);
          if (data.bb) {
            bounds.minX = Math.min(bounds.minX, data.bb[id * 4]!);
            bounds.minY = Math.min(bounds.minY, data.bb[id * 4 + 1]!);
            bounds.maxX = Math.max(bounds.maxX, data.bb[id * 4 + 2]!);
            bounds.maxY = Math.max(bounds.maxY, data.bb[id * 4 + 3]!);
          } else {
            const end = data.ii[id]! + data.nn[id]!;
            for (let i = data.ii[id]!; i < end; i++) {
              bounds.minX = Math.min(bounds.minX, data.xx[i]!);
              bounds.minY = Math.min(bounds.minY, data.yy[i]!);
              bounds.maxX = Math.max(bounds.maxX, data.xx[i]!);
              bounds.maxY = Math.max(bounds.maxY, data.yy[i]!);
            }
          }
        }
      const polygon = layer.geometry_type === 'polygon';
      entries.push({ layerIndex, featureId, bounds });
      if (polygon && overlaps(bounds, sketchBounds)) {
        contacted = true;
        region.minX = Math.min(region.minX, bounds.minX);
        region.minY = Math.min(region.minY, bounds.minY);
        region.maxX = Math.max(region.maxX, bounds.maxX);
        region.maxY = Math.max(region.maxY, bounds.maxY);
      }
    }
  }
  const candidates = new Map<number, Set<number>>();
  if (!contacted) return { candidates, region };
  for (const { layerIndex, featureId, bounds } of entries) {
    if (!overlaps(bounds, region)) continue;
    let ids = candidates.get(layerIndex);
    if (!ids) {
      ids = new Set();
      candidates.set(layerIndex, ids);
    }
    ids.add(featureId);
  }
  return { candidates, region };
}

/** An exterior sketch interval absent from the local faces may close against
 * boundaries outside the envelope. Never commit only the local subset.
 */
function hasUnenclosedSketch(
  arcs: ArcCollection,
  sketchIds: ReadonlySet<number>,
  boundaryIds: ReadonlySet<number>,
  tiles: PathShape[],
  shapes: PathShape[],
  adapter: MapshaperAdapter,
): boolean {
  const covered = new Set(tiles.flat(2).map(unsignedArcId));
  for (const id of sketchIds) {
    if (boundaryIds.has(id) || covered.has(id)) continue;
    const iter = arcs.getArcIter(id);
    if (!iter.hasNext()) continue;
    const x = iter.x,
      y = iter.y;
    while (iter.hasNext()) {
      if (iter.x === x && iter.y === y) continue;
      const mx = (x + iter.x) / 2,
        my = (y + iter.y) / 2;
      if (!shapes.some((shape) => adapter.testPointInPolygon(mx, my, shape, arcs))) return true;
      break;
    }
  }
  return false;
}
