// Unit tests for bufferLayer — parameter passthrough, mergeFirst
// command-chain shape, and validation rejects.

import { describe, expect, it, vi } from 'vitest';
import { bufferLayer } from './buffer';
import { OK } from '../op-result';
import type { OpContext } from './_context';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { MapshaperLayer, MapshaperDataset } from '../../types/mapshaper-types';

function makeStubCtx(layers: Array<{ name: string; geometry_type?: string }> = [
  { name: 'parks', geometry_type: 'polygon' },
]) {
  const layerObjs: MapshaperLayer[] = layers.map((l) => ({
    name: l.name,
    geometry_type: (l.geometry_type ?? 'polygon') as any,
    shapes: [[[0]]],
  } as MapshaperLayer));
  const dataset: MapshaperDataset = { layers: layerObjs, info: {} } as MapshaperDataset;

  const calls: Array<{ sourceId: string; cmds: ParsedCommand[]; label: string }> = [];
  const ctx: OpContext = {
    host: {
      _removed: false,
      _sources: new globalThis.Map([['s1', {
        getDataset: () => dataset,
        setDataset: () => undefined,
      } as any]]),
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
    applyDatasetReplace: (() => OK) as any,
  };
  return { ctx, calls };
}

describe('bufferLayer — parameter passthrough', () => {
  it('forwards every new option as snake_case keys', async () => {
    const { ctx, calls } = makeStubCtx();
    const r = await bufferLayer(ctx, {
      source: 's1',
      target: 'parks',
      radius: 100,
      capStyle: 'flat',
      vertices: 36,
      arcQuality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      sliceLength: 1024,
      backtrack: 8,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const bufferCmd = calls[0].cmds.find((c) => c.name === 'buffer')!;
    expect(bufferCmd.options).toEqual({
      radius: '100',
      cap_style: 'flat',
      vertices: 36,
      arc_quality: 4,
      tolerance: 0.5,
      type: 'outer',
      planar: true,
      v2: true,
      slice_length: 1024,
      backtrack: 8,
    });
  });
});

describe('bufferLayer — mergeFirst', () => {
  it('inserts dissolve2 before buffer for polygon layers', async () => {
    const { ctx, calls } = makeStubCtx([{ name: 'parks', geometry_type: 'polygon' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'parks', radius: 50, mergeFirst: true,
    });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const names = calls[0].cmds.map((c) => c.name);
    expect(names).toEqual(['target', 'dissolve2', 'buffer']);
    expect(calls[0].label).toBe('Buffer (merged) parks');
  });

  it('skips dissolve2 and warns for non-polygon layers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { ctx, calls } = makeStubCtx([{ name: 'roads', geometry_type: 'polyline' }]);
    const r = await bufferLayer(ctx, {
      source: 's1', target: 'roads', radius: 50, mergeFirst: true,
    });
    expect(r.ok).toBe(true);
    const names = calls[0].cmds.map((c) => c.name);
    expect(names).toEqual(['target', 'buffer']);
    expect(calls[0].label).toBe('Buffer roads');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/mergeFirst ignored.*polyline/);
    warn.mockRestore();
  });

  it('omits dissolve2 when mergeFirst is undefined / false', async () => {
    const { ctx, calls } = makeStubCtx();
    await bufferLayer(ctx, { source: 's1', target: 'parks', radius: 50 });
    expect(calls[0].cmds.map((c) => c.name)).toEqual(['target', 'buffer']);
  });
});
