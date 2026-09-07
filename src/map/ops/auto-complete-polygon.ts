import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { isPathLayer, type MapshaperLayer, type PathShape } from '../../types/mapshaper-types';
import { Err, type OpResult } from '../op-result';
import type { AutoCompletePolygonOptions, AutoCompletePolygonResult } from '../types';
import { getLayerId } from '../../source/layer-utils';
import type { OpContext } from './_context';
import {
  normalizeConsecutiveCoordinates,
  SegmentConflictIndex,
  unsignedArcId,
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
    const result = await ctx.runPreparedDatasetMutation<AutoCompletePolygonResult>(
      sourceId,
      'Auto-complete polygon',
      (working) => {
        const arcs = working.arcs!;
        const sketchId = adapter.appendArc(arcs, line);
        const sketchLayer: MapshaperLayer = { geometry_type: 'polyline', shapes: [[[sketchId]]] };
        working.layers.push(sketchLayer);
        // Cut both the sketch and all existing paths at the exact contacts. Shared
        // boundaries then reference the same arcs, including intermediate vertices.
        adapter.addIntersectionCuts(working, { no_snap: true, rebuild_topology: true });
        const sketchIds = new Set((sketchLayer.shapes![0] as PathShape).flat().map(unsignedArcId));
        working.layers.pop();
        for (let layerIndex = 0; layerIndex < working.layers.length; layerIndex++) {
          const layer = working.layers[layerIndex]!;
          if (!isPathLayer(layer) || layer.geometry_type !== 'polygon' || !layer.shapes) continue;
          const shapes = layer.shapes.filter((shape): shape is PathShape => !!shape?.length);
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
          if (!tiles.length) continue;
          const firstId = layer.shapes.length;
          layer.shapes.push(...tiles);
          const records = layer.data?.getRecords?.();
          if (records) records.push(...tiles.map(() => ({})));
          return {
            value: {
              createdCount: tiles.length,
              features: tiles.map((_, index) => ({
                source: sourceId,
                layer: getLayerId(layer, layerIndex),
                id: firstId + index,
              })),
            },
            selection: ctx.host._selection.getAll(),
          };
        }
        return Err.validation('line', 'line and existing boundaries do not enclose a new face');
      },
    );
    if (result.ok || result.error.kind !== 'validation') return result;
  }
  return Err.validation('line', 'line and existing boundaries do not enclose a new face');
}
