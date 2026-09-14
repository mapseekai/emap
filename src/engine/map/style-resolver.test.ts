import { describe, expect, it } from 'vitest';
import type { MapshaperDataset, MapshaperLayer } from '../../shared/types/mapshaper-types';
import { StyleResolver } from './style-resolver';
import { DEFAULT_LAYER_COLOR, type FillLayerPaint } from './layer';

function makeLayer(records: Array<Record<string, unknown>>, shapes: unknown[] | null = null) {
  // 形状与记录一一对应的最小层夹具：resolver 只读 shapes.length 与 getRecords。
  return {
    geometry_type: 'polygon',
    shapes: shapes ?? records.map((_, i) => [[i]]),
    data: { getRecords: () => records },
  } as unknown as MapshaperLayer;
}
const dataset = {
  layers: [],
  arcs: null,
  editVersion: 0,
  attributeVersion: 0,
} as unknown as MapshaperDataset;

describe('StyleResolver.resolveFill', () => {
  it('returns null for static layers (no expression, no opt-in)', () => {
    const r = new StyleResolver();
    expect(
      r.resolveFill({
        layerId: 'a',
        paint: { 'fill-color': '#fff' },
        styleSource: undefined,
        dataset,
        layer: makeLayer([{}]),
      }),
    ).toBeNull();
  });

  it('evaluates match expression into LUT + buckets', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }, { t: 'b' }, { t: 'a' }]);
    const res = r.resolveFill({
      layerId: 'a',
      paint: { 'fill-color': ['match', ['get', 't'], 'a', '#111111', '#999999'] },
      styleSource: undefined,
      dataset,
      layer,
    })!;
    expect(res.styles).toEqual(['#111111', '#999999']);
    expect([...res.buckets[0]]).toEqual([0, 2]);
    expect([...res.buckets[1]]).toEqual([1]);
  });

  it('declared static fill-color wins over styleSource opt-in', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ fill: '#123456' }]);
    expect(
      r.resolveFill({
        layerId: 'a',
        paint: { 'fill-color': '#ffffff' },
        styleSource: 'mapshaper',
        dataset,
        layer,
      }),
    ).toBeNull();
  });

  it('opt-in reads baked fill field; eval/type errors land in null bucket (theme)', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ fill: '#123456' }, { fill: 42 }, {}]);
    const res = r.resolveFill({
      layerId: 'a',
      paint: undefined,
      styleSource: 'mapshaper',
      dataset,
      layer,
    })!;
    expect(res.styles[0]).toBe('#123456');
    // 42 与缺失 → null 桶（最后一个桶，主题色）
    expect([...res.buckets[1]]).toEqual([1, 2]);
  });

  it('continuous interpolate stays bucket-bounded (≤ 257 + null)', () => {
    const r = new StyleResolver();
    const records = Array.from({ length: 1000 }, (_, i) => ({ v: i / 10 }));
    const layer = makeLayer(records);
    const res = r.resolveFill({
      layerId: 'a',
      paint: {
        'fill-color': ['interpolate', 'linear', ['get', 'v'], 0, '#000000', 100, '#ffffff'],
      },
      styleSource: undefined,
      dataset,
      layer,
    })!;
    expect(res.styles.length).toBeLessThanOrEqual(258);
  });

  it('K above threshold fires onWarn and still renders', () => {
    const warns: Array<{ layerId: string; buckets?: number }> = [];
    const r = new StyleResolver({ onWarn: (w) => warns.push(w) });
    const records = Array.from({ length: 300 }, (_, i) => ({ t: `c${i}` }));
    const layer = makeLayer(records);
    // match 300 个不同类别全部命中 → K=300（无 null 桶），超 256 阈值
    const matchExpr: unknown[] = ['match', ['get', 't']];
    records.forEach((_, i) => matchExpr.push(`c${i}`, `#000${String(i).padStart(3, '0')}`));
    matchExpr.push('#ffffff');
    const res = r.resolveFill({
      layerId: 'L9',
      paint: { 'fill-color': matchExpr },
      styleSource: undefined,
      dataset,
      layer,
    });
    expect(res).not.toBeNull();
    expect(warns).toEqual([{ layerId: 'L9', buckets: 300 }]);
  });

  it('rebuild failure keeps stale cache and warns (no blank frame)', () => {
    const warns: unknown[] = [];
    const r = new StyleResolver({ onWarn: (w) => warns.push(w) });
    const layer = makeLayer([{ t: 'a' }]);
    const good = { 'fill-color': ['get', 't'] };
    const first = r.resolveFill({
      layerId: 'a',
      paint: good,
      styleSource: undefined,
      dataset,
      layer,
    });
    // 指纹变化 + 求值器抛错（非法结构绕过 addLayer 校验直达 resolver 的场景）
    const bad = { 'fill-color': ['bogus-op', 1] };
    const second = r.resolveFill({
      layerId: 'a',
      paint: bad,
      styleSource: undefined,
      dataset,
      layer,
    });
    expect(second).toBe(first);
    expect(warns.length).toBe(1);
  });

  it('cache: same key returns identical reference; attributeVersion bump rebuilds', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }]);
    const paint = { 'fill-color': ['get', 't'] };
    const a1 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    const a2 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    expect(a2).toBe(a1);
    // 夹具 dataset 可变：模拟 bumpAttributeVersion。
    (dataset as { attributeVersion: number }).attributeVersion = 1;
    const a3 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    expect(a3).not.toBe(a1);
    (dataset as { attributeVersion: number }).attributeVersion = 0;
  });

  it('dataset reference swap invalidates', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ t: 'a' }]);
    const paint = { 'fill-color': ['get', 't'] };
    const a1 = r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset, layer });
    const other = { ...dataset };
    expect(
      r.resolveFill({ layerId: 'a', paint, styleSource: undefined, dataset: other, layer }),
    ).not.toBe(a1);
  });
});

describe('StyleResolver non-color paint expressions', () => {
  it('line-dashstyle expression buckets features and fills extras', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ k: 'a' }, { k: 'b' }, { k: 'a' }]);
    const res = r.resolveLine({
      layerId: 'a',
      paint: {
        'line-color': '#123456',
        'line-dashstyle': ['match', ['get', 'k'], 'a', 'dash', 'solid'],
      },
      styleSource: undefined,
      dataset,
      layer,
    })!;
    expect(res.styles).toEqual(['#123456', '#123456']);
    expect(res.extras).toEqual([{ dashType: 'dash' }, { dashType: 'solid' }]);
    expect([...res.buckets[0]]).toEqual([0, 2]);
    expect([...res.buckets[1]]).toEqual([1]);
  });

  it('circle-shape expression buckets; invalid values fall back to the static layer value', () => {
    const r = new StyleResolver();
    const layer = makeLayer([{ k: 'a' }, { k: 'bad' }, { k: 'a' }]);
    const res = r.resolveCircle({
      layerId: 'a',
      paint: {
        'circle-shape': ['match', ['get', 'k'], 'a', 'star', 'nonsense'],
      },
      styleSource: undefined,
      dataset,
      layer,
    })!;
    expect(res.extras).toEqual([{ shape: 'star' }, {}]);
    expect([...res.buckets[0]]).toEqual([0, 2]);
    expect([...res.buckets[1]]).toEqual([1]);
  });

  it('color + dashstyle expressions cross-product into shared buckets', () => {
    const r = new StyleResolver();
    const layer = makeLayer([
      { t: 'a', k: 'x' },
      { t: 'a', k: 'y' },
      { t: 'b', k: 'x' },
    ]);
    const res = r.resolveLine({
      layerId: 'a',
      paint: {
        'line-color': ['match', ['get', 't'], 'a', '#111111', '#999999'],
        'line-dashstyle': ['match', ['get', 'k'], 'x', 'dash', 'dot'],
      },
      styleSource: undefined,
      dataset,
      layer,
    })!;
    expect(res.styles).toEqual(['#111111', '#111111', '#999999']);
    expect(res.extras).toEqual([{ dashType: 'dash' }, { dashType: 'dot' }, { dashType: 'dash' }]);
    expect(res.buckets.map((b) => [...b])).toEqual([[0], [1], [2]]);
  });

  it('static dashstyle without any expression keeps the static painter path', () => {
    const r = new StyleResolver();
    expect(
      r.resolveLine({
        layerId: 'a',
        paint: { 'line-color': '#123456', 'line-dashstyle': 'dash' },
        styleSource: undefined,
        dataset,
        layer: makeLayer([{ k: 'a' }]),
      }),
    ).toBeNull();
    expect(
      r.resolveCircle({
        layerId: 'a',
        paint: { 'circle-shape': 'star' },
        styleSource: undefined,
        dataset,
        layer: makeLayer([{ k: 'a' }]),
      }),
    ).toBeNull();
  });

  it('extras-only expression does not hijack baked fill/stroke fields without styleSource', () => {
    const r = new StyleResolver();
    const records = [
      { k: 'a', fill: '#ff0000', stroke: '#00ff00' },
      { k: 'b', fill: '#ff0000', stroke: '#00ff00' },
    ];
    const circle = r.resolveCircle({
      layerId: 'a',
      paint: { 'circle-shape': ['match', ['get', 'k'], 'a', 'star', 'square'] },
      styleSource: undefined,
      dataset,
      layer: makeLayer(records),
    })!;
    expect([...new Set(circle.styles)]).toEqual([DEFAULT_LAYER_COLOR]);
    expect(circle.extras).toEqual([{ shape: 'star' }, { shape: 'square' }]);
    const line = r.resolveLine({
      layerId: 'b',
      paint: { 'line-dashstyle': ['match', ['get', 'k'], 'a', 'dash', 'dot'] },
      styleSource: undefined,
      dataset,
      layer: makeLayer(records),
    })!;
    expect([...new Set(line.styles)]).toEqual([DEFAULT_LAYER_COLOR]);
  });

  it('rejects prototype-chain property names as enum values', () => {
    const r = new StyleResolver();
    const records = [{ k: 'toString' }, { k: 'constructor' }, { k: '__proto__' }];
    const res = r.resolveCircle({
      layerId: 'a',
      paint: { 'circle-shape': ['get', 'k'] },
      styleSource: undefined,
      dataset,
      layer: makeLayer(records),
    })!;
    // 三个值都是 Object.prototype 上的继承属性名，必须全部判定非法 → 空 extras、单一默认色桶。
    expect(res.extras).toEqual([{}]);
    expect(res.buckets.map((b) => [...b])).toEqual([[0, 1, 2]]);
  });
});

const RUN = process.env.STYLE_BENCH === '1';

// 基准不进默认 CI：STYLE_BENCH=1 显式开启。输出 cold/warm 毫秒供 spec §5/§9 回填。
describe.skipIf(!RUN)('style resolution bench (STYLE_BENCH=1)', () => {
  for (const n of [100_000, 1_000_000]) {
    it(`resolves ${n} records and reports ms`, () => {
      const records = Array.from({ length: n }, (_, i) => ({ pop: i % 100 }));
      // 基准夹具：resolver 只读 shapes.length 与 getRecords。
      const layer = {
        shapes: records.map((_, i) => [[i]]),
        data: { getRecords: () => records },
      } as unknown as MapshaperLayer;
      const dataset = { attributeVersion: 0 } as unknown as MapshaperDataset;
      const r = new StyleResolver();
      const paint = {
        'fill-color': ['step', ['get', 'pop'], '#a', 25, '#b', 50, '#c', 75, '#d'],
      } as unknown as FillLayerPaint;
      const t0 = performance.now();
      r.resolveFill({ layerId: 'b', paint, styleSource: undefined, dataset, layer });
      const cold = performance.now() - t0;
      const t1 = performance.now();
      r.resolveFill({ layerId: 'b', paint, styleSource: undefined, dataset, layer });
      const warm = performance.now() - t1;
      console.log(
        JSON.stringify({ records: n, coldMs: +cold.toFixed(2), warmMs: +warm.toFixed(2) }),
      );
      expect(warm).toBeLessThan(1); // 缓存命中 ≈ 0
    });
  }
});
