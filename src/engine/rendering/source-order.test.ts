import { describe, expect, it, vi } from 'vitest';
import type { LayerSpecification } from '../map/layer';
import type { RenderPass } from '../../runtime/services/contracts/render-pass';
import { checkedSourceOrder, sourceRenderBlocks, type RenderPassStage } from './source-order';

const layer = (id: string, source: string): LayerSpecification => ({
  id,
  source,
  type: 'line',
});
const pass = () => vi.fn() as RenderPass;

describe('source render order', () => {
  it('validates and clones top-first source order', () => {
    const input = ['top', 'bottom'];
    expect(checkedSourceOrder(input)).toEqual(input);
    expect(checkedSourceOrder(input)).not.toBe(input);
    for (const invalid of [[''], ['a', 'a'], [String('x').repeat(257)]]) {
      expect(() => checkedSourceOrder(invalid)).toThrow(/Source order/);
    }
  });

  it('interleaves vector source blocks and source passes bottom-first', () => {
    const rasterTop = pass();
    const rasterBottom = pass();
    const passes = new Map<RenderPass, RenderPassStage>([
      [rasterTop, { sourceId: 'r-top' }],
      [rasterBottom, { sourceId: 'r-bottom' }],
    ]);
    const blocks = sourceRenderBlocks(
      [layer('v-top:a', 'v-top'), layer('v-top:b', 'v-top'), layer('v-bottom', 'v-bottom')],
      passes,
      ['r-top', 'v-top', 'r-bottom', 'v-bottom'],
    );
    expect(blocks).toEqual([
      { layers: [layer('v-bottom', 'v-bottom')] },
      { pass: rasterBottom },
      { layers: [layer('v-top:a', 'v-top'), layer('v-top:b', 'v-top')] },
      { pass: rasterTop },
    ]);
  });

  it('keeps unconfigured content below configured content for compatibility', () => {
    const legacyRaster = pass();
    const configuredRaster = pass();
    const blocks = sourceRenderBlocks(
      [layer('legacy-vector', 'legacy'), layer('configured-vector', 'vector')],
      new Map<RenderPass, RenderPassStage>([
        [legacyRaster, { sourceId: 'legacy-raster' }],
        [configuredRaster, { sourceId: 'raster' }],
      ]),
      ['raster', 'vector'],
    );
    expect(blocks).toEqual([
      { pass: legacyRaster },
      { layers: [layer('legacy-vector', 'legacy')] },
      { layers: [layer('configured-vector', 'vector')] },
      { pass: configuredRaster },
    ]);
  });

  it('retains an empty vector block for raster-only frames', () => {
    const raster = pass();
    expect(sourceRenderBlocks([], new Map([[raster, { sourceId: 'raster' }]]), ['raster'])).toEqual(
      [{ layers: [] }, { pass: raster }],
    );
  });
});
