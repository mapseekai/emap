import type { AppendedArc } from '../../adapter/mapshaper-adapter';
import { getDefaultMapshaperAdapter } from '../../adapter/mapshaper-adapter';
import { resolveLayerInList } from '../../map/layer-registry';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';
import { defineDuckDbTool, requireToolInput, toolParams } from '../core/tool-definition';
import {
  finitePositive,
  processingValidation,
  type DuckDbProcessingGeometryOptions,
} from '../core/runners/processing';
import type { DuckDbRuntime } from '../runtime';

export interface DensifyOptions extends DuckDbProcessingGeometryOptions {
  maxSegmentLength: number;
}
function densifyArc(
  dataset: MapshaperDataset,
  arcId: number,
  maxSegmentLength: number,
): AppendedArc {
  const iter = dataset.arcs!.getArcIter(arcId);
  const xs: number[] = [];
  const ys: number[] = [];
  while (iter.hasNext()) {
    xs.push(iter.x);
    ys.push(iter.y);
  }
  if (xs.length < 2) return { xx: new Float64Array(xs), yy: new Float64Array(ys) };
  const outX = [xs[0]!],
    outY = [ys[0]!];
  for (let i = 1; i < xs.length; i++) {
    const x0 = xs[i - 1]!,
      y0 = ys[i - 1]!,
      x1 = xs[i]!,
      y1 = ys[i]!;
    const parts = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSegmentLength));
    for (let part = 1; part <= parts; part++) {
      const t = part / parts;
      outX.push(x0 + (x1 - x0) * t);
      outY.push(y0 + (y1 - y0) * t);
    }
  }
  return { xx: new Float64Array(outX), yy: new Float64Array(outY) };
}
export async function densify(
  input: MapshaperDataset,
  options: DensifyOptions,
  _runtime?: DuckDbRuntime | null,
) {
  const distance = finitePositive('densify', 'maxSegmentLength', options.maxSegmentLength);
  const adapter = getDefaultMapshaperAdapter();
  const copy = adapter.copyDataset(input);
  if (copy.arcs) {
    const arcs: AppendedArc[] = [];
    for (let arcId = 0; arcId < copy.arcs.size(); arcId++)
      arcs.push(densifyArc(copy, arcId, distance));
    copy.arcs = adapter.createArcCollection(arcs);
  }
  const layers = copy.layers ?? [];
  let selected: MapshaperLayer | undefined = layers[0];
  if (typeof options.layer === 'string')
    selected = resolveLayerInList(layers, options.layer) ?? undefined;
  if (typeof options.layer === 'number') selected = layers[options.layer];
  if (!selected)
    throw processingValidation(
      'densify',
      `layer ${String(options.layer ?? 0)} was not found`,
      'layer',
    );
  if (options.outputLayer) selected.name = options.outputLayer;
  copy.layers = [selected];
  return copy;
}
export const densifyTool = defineDuckDbTool({
  id: 'densify',
  category: 'geometry',
  title: 'Densify',
  description: 'Insert vertices so no segment exceeds a maximum length.',
  inputs: [
    {
      name: 'input',
      description: 'Input line or polygon features.',
      required: true,
      geometry: ['polyline', 'polygon'],
    },
  ],
  parameters: [
    {
      name: 'maxSegmentLength',
      description: 'Maximum segment length in dataset units.',
      type: 'number',
      required: true,
      exclusiveMinimum: 0,
    },
  ],
  crs: 'projected',
  units: 'dataset',
  output: {
    geometry: 'derived',
    cardinality: 'preserve',
    attributes: 'preserve',
    mutatesInput: false,
  },
  cost: 'medium',
  agent: {
    summary: 'Add vertices along long segments.',
    whenToUse: ['Prepare geometry for projection or distance-sensitive operations.'],
    keywords: ['densify', 'add vertices', 'segment length'],
  },
  execute: (c) => densify(requireToolInput(c, 'input'), toolParams<DensifyOptions>(c), c.runtime),
});
