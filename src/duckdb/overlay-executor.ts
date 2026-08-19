import type { Table } from 'apache-arrow';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import { DuckDbOperationError } from './errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  duckDbPipelineMessages,
  requireDuckDbRuntime,
  runDuckDbPipeline,
} from './pipeline';
import { getDuckDbRuntime, type DuckDbRuntime } from './runtime';
import { buildOverlaySql, type OverlayDuckDbFunction } from './sql';
import { alignSecondaryDatasetCrs } from './dataset-crs';

export interface DuckDbOverlayOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
}

export interface DuckDbOverlayOperationSpec {
  id: string;
  duckDbFunction: OverlayDuckDbFunction;
}

function getSelectedLayer(
  dataset: MapshaperDataset,
  selector: string | number | undefined,
): MapshaperLayer | undefined {
  const layers = dataset.layers ?? [];
  if (typeof selector === 'string') {
    return layers.find((layer) => layer.name === selector || layer.id === selector);
  }
  return layers[selector ?? 0];
}

function datasetWithEmptyMaskGeometry(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayOptions,
): MapshaperDataset | null {
  const inputLayer = getSelectedLayer(inputDataset, opts.inputLayer);
  const maskLayer = getSelectedLayer(maskDataset, opts.maskLayer);
  if (!inputLayer?.geometry_type || !maskLayer || maskLayer.geometry_type) return null;
  if ((maskLayer.shapes?.length ?? 0) !== 0) return null;
  if ((maskLayer.data?.getRecords?.().length ?? 0) !== 0) return null;

  return {
    ...maskDataset,
    layers: (maskDataset.layers ?? []).map((layer) =>
      layer === maskLayer
        ? { ...layer, geometry_type: inputLayer.geometry_type, shapes: [] }
        : layer,
    ),
  };
}

export async function processOverlayWithDuckDb(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: DuckDbOverlayOptions,
  spec: DuckDbOverlayOperationSpec,
  runtime: DuckDbRuntime | null = getDuckDbRuntime(),
): Promise<MapshaperDataset> {
  const rt = requireDuckDbRuntime(runtime);
  const messages = duckDbPipelineMessages(spec.id);

  const inputGeometryColumn = opts.inputGeometryColumn ?? 'geometry';
  const maskGeometryColumn = opts.maskGeometryColumn ?? 'geometry';

  let input: Table;
  let mask: Table;
  try {
    const alignedMaskDataset = await alignSecondaryDatasetCrs(inputDataset, maskDataset);
    input = datasetToArrowInput(
      inputDataset,
      { layer: opts.inputLayer, geometryColumn: inputGeometryColumn },
      spec.id,
    );
    try {
      mask = datasetToArrowInput(
        alignedMaskDataset,
        { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
        spec.id,
      );
    } catch (err) {
      const emptyMaskDataset = datasetWithEmptyMaskGeometry(inputDataset, alignedMaskDataset, opts);
      if (!emptyMaskDataset) throw err;
      mask = datasetToArrowInput(
        emptyMaskDataset,
        { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
        spec.id,
      );
    }
  } catch (err) {
    throw new DuckDbOperationError('conversion-failed', messages.inputConversion, { cause: err });
  }

  return runDuckDbPipeline({
    label: spec.id,
    runtime: rt,
    inputs: [
      { table: input, prefix: 'emap_duckdb_overlay_input' },
      { table: mask, prefix: 'emap_duckdb_overlay_mask' },
    ],
    buildSql: ([inputTableName, maskTableName]) =>
      buildOverlaySql({
        duckDbFunction: spec.duckDbFunction,
        inputGeometryColumn,
        inputTableName: inputTableName!,
        maskGeometryColumn,
        maskTableName: maskTableName!,
      }),
    convertResult: (resultTable) =>
      arrowResultToDataset(
        resultTable,
        { layerName: opts.outputLayer, geometryColumn: inputGeometryColumn },
        inputDataset,
        spec.id,
      ),
  });
}
