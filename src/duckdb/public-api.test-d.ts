import type {
  DuckDbToolId,
  DuckDbMapOpContext,
  DuckDbAttributeFilterLayerOptions,
  DuckDbGeoParquetQueryLayerOptions,
  DuckDbOverlayLayerOptions,
  DuckDbSpatialSummaryJoinLayerOptions,
} from './index';

// This file is checked by tsc, not executed by Vitest.
const knownTools: DuckDbToolId[] = [
  'buffer',
  'x',
  'isValid',
  'repairGeometry',
  'spatialSummaryJoin',
];
const idsAreNotWidened: string extends DuckDbToolId ? true : false = false;
// @ts-expect-error Unknown tools must not satisfy the public ID type.
const unknownTool: DuckDbToolId = 'not-a-real-tool';

declare const filterInput: Omit<DuckDbAttributeFilterLayerOptions, 'output'>;
declare const parquetInput: Omit<DuckDbGeoParquetQueryLayerOptions, 'output'>;
declare const overlayInput: Omit<DuckDbOverlayLayerOptions, 'output'>;
declare const summaryInput: Omit<DuckDbSpatialSummaryJoinLayerOptions, 'output'>;
// @ts-expect-error Every map adapter requires an explicit output destination.
const filter: DuckDbAttributeFilterLayerOptions = filterInput;
// @ts-expect-error Every map adapter requires an explicit output destination.
const parquet: DuckDbGeoParquetQueryLayerOptions = parquetInput;
// @ts-expect-error Every map adapter requires an explicit output destination.
const overlay: DuckDbOverlayLayerOptions = overlayInput;
// @ts-expect-error Every map adapter requires an explicit output destination.
const summary: DuckDbSpatialSummaryJoinLayerOptions = summaryInput;
// @ts-expect-error A commit cannot await between version validation and mutation.
const asyncSetter: DuckDbMapOpContext['setSourceDataset'] = async () => {};

void [knownTools, idsAreNotWidened, unknownTool, filter, parquet, overlay, summary, asyncSetter];
