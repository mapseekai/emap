// Shared test scaffolding for op-level unit tests. Each op gets a stubbed
// `OpContext` whose `runDatasetCommandParsed` records the call instead
// of running mapshaper — keeps tests fast and free of mapshaper-state
// coupling. Extracted so multiple op test files can stay in sync when
// the host contract grows new fields.

import { OK } from '../../src/engine/map/op-result';
import { TopologySource } from '../../src/domain/source/topology-source';
import { asMutableTopologySource } from '../../src/domain/source/source';
import { EditHistory } from '../../src/domain/edit/edit-history';
import { Selection } from '../../src/engine/map/selection';
import { LayerRegistry } from '../../src/engine/map/layer-registry';
import type { OpContext } from '../../src/engine/map/ops/_context';
import type { ParsedCommand } from '../../src/integrations/mapshaper/adapter';
import type { MapshaperLayer, MapshaperDataset } from '../../src/shared/types/mapshaper-types';

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
