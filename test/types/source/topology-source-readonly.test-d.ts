// Type-level contract for TopologySource's zero-copy read-only views.
// Checked by `tsc --noEmit`; Vitest does not execute *.test-d.ts files.
import type { TopologySource } from '../../../src/index';

declare const source: TopologySource;

const dataset = source.getDataset();
if (dataset) {
  const layerName: string | undefined = dataset.layers[0]?.name;
  const firstX: number | undefined = dataset.arcs?.getVertexData?.().xx[0];
  void layerName;
  void firstX;

  // @ts-expect-error dataset layer arrays are read-only
  dataset.layers.push({ shapes: null });
  // @ts-expect-error layer metadata is read-only
  dataset.layers[0].name = 'mutated';
  // @ts-expect-error nested shape arrays are read-only
  dataset.layers[0].shapes?.push(null);
  // @ts-expect-error attribute record arrays are read-only
  dataset.layers[0].data?.getRecords?.().push({ changed: true });
  // @ts-expect-error dataset metadata is read-only
  dataset.info!.crs_string = 'EPSG:3857';
  // @ts-expect-error mutating ArcCollection methods are not public
  dataset.arcs?.setRetainedInterval?.(1);
  // @ts-expect-error raw typed-array mutators are not exposed
  dataset.arcs?.getVertexData?.().xx.fill(0);
}

const layers = source.getLayers();
// @ts-expect-error the source's live layer array is read-only
layers.push({ shapes: null });

const arcs = source.getArcs();
// @ts-expect-error direct coordinate mutation is not exposed
arcs?.transformPoints?.(() => [0, 0]);

void source.export({ format: 'flatgeobuf' });
