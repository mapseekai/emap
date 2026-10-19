// Shared test scaffolding for op-level unit tests. Each op gets a stubbed
// `OpContext` whose `runDatasetCommandParsed` records the call instead
// of running mapshaper — keeps tests fast and free of mapshaper-state
// coupling. Extracted so multiple op test files can stay in sync when
// the host contract grows new fields.

import { OK } from '../op-result';
import { TopologySource } from '../../../domain/source/topology-source';
import { asMutableTopologySource } from '../../../domain/source/source';
import { EditHistory } from '../../../domain/edit/edit-history';
import { Selection } from '../selection';
import { LayerRegistry } from '../layer-registry';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../../integrations/mapshaper/adapter';
import type { MapshaperLayer, MapshaperDataset } from '../../../shared/types/mapshaper-types';

export interface StubLayer {
  name: string;
  geometry_type?: MapshaperLayer['geometry_type'];
}

export interface StubCtxResult {
  ctx: OpContext;
  calls: Array<{ sourceId: string; cmds: ParsedCommand[]; label: string }>;
}

export function makeStubCtx(layers: StubLayer[] = [{ name: 'parks' }]): StubCtxResult {
  const layerObjs: MapshaperLayer[] = layers.map((layer) => ({
    name: layer.name,
    geometry_type: layer.geometry_type ?? 'polygon',
    shapes: [],
  }));
  const dataset: MapshaperDataset = { layers: layerObjs, info: {} };
  const source = new TopologySource('s1');
  source.setDataset(dataset, false);
  const sources = new Map([['s1', asMutableTopologySource(source)]]);
  const calls: StubCtxResult['calls'] = [];
  const ctx: OpContext = {
    host: {
      _removed: false,
      _sources: sources,
      _history: new EditHistory(),
      _selection: new Selection(),
      _activeTransaction: null,
      _workerPool: null,
      _workerMode: false,
      _workerThreshold: 1e9,
      layers: new LayerRegistry(sources),
      _resolveRenderLayerTarget: () => null,
      _filterMaskForRenderLayer: () => null,
      _scheduleRender: () => undefined,
      _fireHistoryChange: () => undefined,
      _fireSelectionChange: () => undefined,
      _invalidateShapeCachesForSources: () => undefined,
      _clearSpatialIndexesForSources: () => undefined,
      _allowExpressionEvaluation: () => true,
      fire: () => undefined,
    },
    runDatasetCommandParsed: (sourceId, cmds, label) => {
      calls.push({ sourceId, cmds, label });
      return Promise.resolve(OK);
    },
    runPreparedDatasetCommandParsed: unsupportedRunner,
    runPreparedDatasetMutation: unsupportedRunner,
    runPreparedEditCommand: unsupportedRunner,
    runPreparedEditCommandMany: unsupportedRunner,
  };
  return { ctx, calls };
}

async function unsupportedRunner(): Promise<never> {
  throw new Error('Prepared runners are not configured in this command-only fixture');
}
