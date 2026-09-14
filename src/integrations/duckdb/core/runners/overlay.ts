import type { Table } from 'apache-arrow';
import type { MapshaperDataset, MapshaperLayer } from '../../../../shared/types/mapshaper-types';
import { alignSecondaryDatasetCrs } from '../dataset-crs';
import { DuckDbOperationError } from '../../errors';
import {
  arrowResultToDataset,
  datasetToArrowInput,
  pipelineMessages,
  requireRuntime,
  runPipeline,
} from '../pipeline';
import { type DuckDbRuntime } from '../../runtime';
import { buildOverlaySql, type OverlayDuckDbFunction } from '../sql/overlay';

export interface OverlayRunnerOptions {
  inputLayer?: string | number;
  maskLayer?: string | number;
  outputLayer?: string;
  inputGeometryColumn?: string;
  maskGeometryColumn?: string;
}

export interface OverlayOperation {
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
  opts: OverlayRunnerOptions,
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

/** Shared input+mask runner for clip/intersect/difference overlay tools. */
export async function runOverlayTool(
  inputDataset: MapshaperDataset,
  maskDataset: MapshaperDataset,
  opts: OverlayRunnerOptions,
  operation: OverlayOperation,
  runtime: DuckDbRuntime | null = null,
): Promise<MapshaperDataset> {
  const rt = requireRuntime(runtime);
  const messages = pipelineMessages(operation.id);
  const inputGeometryColumn = opts.inputGeometryColumn ?? 'geometry';
  const maskGeometryColumn = opts.maskGeometryColumn ?? 'geometry';

  let input: Table;
  let mask: Table;
  try {
    const alignedMaskDataset = await alignSecondaryDatasetCrs(inputDataset, maskDataset);
    input = datasetToArrowInput(
      inputDataset,
      { layer: opts.inputLayer, geometryColumn: inputGeometryColumn },
      operation.id,
    );
    try {
      mask = datasetToArrowInput(
        alignedMaskDataset,
        { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
        operation.id,
      );
    } catch (err) {
      const emptyMaskDataset = datasetWithEmptyMaskGeometry(inputDataset, alignedMaskDataset, opts);
      if (!emptyMaskDataset) throw err;
      mask = datasetToArrowInput(
        emptyMaskDataset,
        { layer: opts.maskLayer, geometryColumn: maskGeometryColumn },
        operation.id,
      );
    }
  } catch (err) {
    throw new DuckDbOperationError('conversion-failed', messages.inputConversion, { cause: err });
  }

  return runPipeline({
    label: operation.id,
    runtime: rt,
    inputs: [
      { table: input, prefix: 'emap_duckdb_overlay_input' },
      { table: mask, prefix: 'emap_duckdb_overlay_mask' },
    ],
    buildSql: ([inputTableName, maskTableName]) =>
      buildOverlaySql({
        duckDbFunction: operation.duckDbFunction,
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
        operation.id,
      ),
  });
}
