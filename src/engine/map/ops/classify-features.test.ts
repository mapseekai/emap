import { describe, expect, it } from 'vitest';
import type { MapshaperDataset, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import type { OpContext } from './_context';
import { classifyFeatures } from './classify-features';
import { makeStubCtx, type StubCtxResult } from './_test-helpers';

// makeStubCtx 的 source id 固定为 's1'，layer 无 data——按记录注入。
function ctxWithLayer(records: Array<Record<string, unknown>>): {
  ctx: OpContext;
  calls: StubCtxResult['calls'];
  dataset: MapshaperDataset;
} {
  const { ctx, calls } = makeStubCtx([{ name: 'l' }]);
  const dataset = ctx.host._sources.get('s1')?.getDataset?.();
  if (!dataset) throw new Error('stub source missing dataset');
  // stub 只需 getRecords 一个方法；DataTable 完整接口与此无关。
  dataset.layers[0].data = { getRecords: () => records } as unknown as NonNullable<
    MapshaperLayer['data']
  >;
  dataset.editVersion = 0;
  dataset.attributeVersion = 0;
  return { ctx, calls, dataset };
}

function classifyOptionsOf(calls: StubCtxResult['calls']) {
  return calls[0].cmds[1].options;
}

describe('classifyFeatures validation', () => {
  it('rejects missing field / non-numeric sequential / classes<2 / empty colors', async () => {
    const { ctx } = ctxWithLayer([{ pop: 1 }]);
    await expect(
      classifyFeatures(ctx, {
        source: 's1',
        target: 'l',
        field: 'nope',
        method: 'quantile',
        classes: 4,
        colors: ['#111'],
      }),
    ).resolves.toMatchObject({ ok: false, error: { kind: 'validation' } });
    await expect(
      classifyFeatures(ctx, {
        source: 's1',
        target: 'l',
        field: 'pop',
        method: 'quantile',
        classes: 1,
        colors: ['#111', '#222'],
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      classifyFeatures(ctx, {
        source: 's1',
        target: 'l',
        field: 'pop',
        method: 'quantile',
        classes: 4,
        colors: [],
      }),
    ).resolves.toMatchObject({ ok: false });
  });

  it('emits explicit breaks/colors/null_value and bumps attributeVersion', async () => {
    const { ctx, calls, dataset } = ctxWithLayer([
      { pop: 10 },
      { pop: 20 },
      { pop: 30 },
      { pop: 40 },
    ]);
    const res = await classifyFeatures(ctx, {
      source: 's1',
      target: 'l',
      field: 'pop',
      method: 'equal-interval',
      classes: 2,
      colors: ['#111111', '#999999'],
      nullValue: '#eeeeee',
    });
    expect(res.ok).toBe(true);
    const commands = calls[0].cmds;
    expect(commands[0]).toEqual({ name: 'target', options: { target: 'l' } });
    expect(commands[1].name).toBe('classify');
    expect(commands[1].options).toMatchObject({
      field: 'pop',
      breaks: [25],
      colors: ['#111111', '#999999'],
      save_as: 'fill',
      null_value: '#eeeeee',
    });
    expect(dataset.attributeVersion).toBe(1);
    expect(res).toMatchObject({
      value: {
        kind: 'sequential',
        breaks: [25],
        counts: [2, 2],
        nullColor: '#eeeeee',
        nullCount: 0,
        featureCount: 4,
      },
    });
  });

  it('categorical echoes effective other/null colors and counts', async () => {
    const { ctx, calls } = ctxWithLayer([{ t: 'a' }, { t: 'z' }, { t: null }]);
    const res = await classifyFeatures(ctx, {
      source: 's1',
      target: 'l',
      field: 't',
      method: 'categorical',
      categories: ['a'],
      colors: ['#111111'],
      nullValue: '#eeeeee',
      otherColor: '#123456',
    });
    expect(classifyOptionsOf(calls)).toMatchObject({
      categories: ['a'],
      other: '#123456',
      null_value: '#eeeeee',
    });
    expect(res).toMatchObject({
      value: {
        kind: 'categorical',
        counts: [1],
        otherCount: 1,
        nullCount: 1,
        otherColor: '#123456',
        nullColor: '#eeeeee',
      },
    });
  });

  it('returns defensive copies of caller-owned classification arrays', async () => {
    const { ctx } = ctxWithLayer([{ t: 'a' }, { t: 'b' }]);
    const categories = ['a', 'b'];
    const colors = ['#111111', '#999999'];
    const res = await classifyFeatures(ctx, {
      source: 's1',
      target: 'l',
      field: 't',
      method: 'categorical',
      categories,
      colors,
    });
    if (!res.ok) throw new Error('classification unexpectedly failed');

    categories[0] = 'changed';
    colors[0] = '#ffffff';

    expect(res.value.categories).toEqual(['a', 'b']);
    expect(res.value.colors).toEqual(['#111111', '#999999']);
  });
});
