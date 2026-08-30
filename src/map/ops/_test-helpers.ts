// Shared test scaffolding for op-level unit tests. Each op gets a stubbed
// `OpContext` whose `runDatasetCommandParsed` records the call instead
// of running mapshaper — keeps tests fast and free of mapshaper-state
// coupling. Extracted so multiple op test files can stay in sync when
// the host contract grows new fields.

import { OK, type OpResult } from '../op-result';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { MapshaperLayer, MapshaperDataset } from '../../types/mapshaper-types';

export interface StubLayerSpec {
  name: string;
  geometry_type?: string;
}

export interface StubCtxResult {
  ctx: OpContext;
  calls: Array<{ sourceId: string; cmds: ParsedCommand[]; label: string }>;
}

export function makeStubCtx(layers: StubLayerSpec[] = [{ name: 'parks' }]): StubCtxResult {
  const layerObjs: MapshaperLayer[] = layers.map(
    (l) =>
      ({
        name: l.name,
        geometry_type: (l.geometry_type ?? 'polygon') as any,
        shapes: [[[0]]],
      }) as MapshaperLayer,
  );
  const dataset: MapshaperDataset = { layers: layerObjs, info: {} } as MapshaperDataset;

  const calls: StubCtxResult['calls'] = [];
  const ctx: OpContext = {
    host: {
      _removed: false,
      _sources: new globalThis.Map([
        [
          's1',
          {
            getDataset: () => dataset,
            setDataset: () => undefined,
          } as any,
        ],
      ]),
      _history: null as any,
      _selection: null as any,
      _activeTransaction: null,
      _validators: null as any,
      _workerPool: null,
      _workerMode: false,
      _workerThreshold: 1e9,
      layers: { resolve: () => null } as any,
      _resolveLayer: () => null,
      _scheduleRender: () => undefined,
      _fireHistoryChange: () => undefined,
      _fireSelectionChange: () => undefined,
      _invalidateShapeCachesForSources: () => undefined,
      _clearSpatialIndexesForSources: () => undefined,
      _allowExpressionEvaluation: () => true,
      fire: () => undefined,
    } as any,
    runDatasetCommand: (() => Promise.resolve(OK)) as any,
    runDatasetCommandParsed: (sourceId, cmds, label) => {
      calls.push({ sourceId, cmds, label });
      return Promise.resolve(OK);
    },
    runPreparedDatasetCommandParsed: () => Promise.resolve(OK),
    runPreparedDatasetMutation: <T>() => Promise.resolve(OK as OpResult<T>),
    runPreparedEditCommand: <T>() => Promise.resolve(OK as OpResult<T>),
  };
  return { ctx, calls };
}
