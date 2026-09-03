import { describe, expect, it } from 'vitest';
import { StyleResolver } from './style-resolver';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { FillLayerPaint } from './layer';

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
