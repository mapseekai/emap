import { inspectContext, inspectServices } from '../../../src/runtime/context/inspection';
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Emap } from '../../../src/engine/map/map';
describe('headless composition', () => {
  it('mounts a complete document and processing workspace without DOM or Canvas', async () => {
    expect(typeof document).toBe('undefined');
    const map = await Emap.create({ preset: 'headless' });
    expect(!!map.ctx.get('document')).toBe(true);
    expect(!!map.ctx.get('mapEvents')).toBe(true);
    expect(!!map.ctx.get('render')).toBe(false);
    expect(!!map.ctx.get('surface')).toBe(false);
    expect(inspectContext(map.ctx).every((plugin) => plugin.state === 'ACTIVE')).toBe(true);
    await map.dispose();
    expect(inspectServices(map.ctx)).toEqual([]);
  });
  it('isolates document and policy state across workspaces', async () => {
    const first = await Emap.create({ preset: 'headless' });
    const second = await Emap.create({ preset: 'headless' });
    first.setExpressionPolicy('trusted');
    expect(second.getExpressionPolicy()).toBe('disabled');
    expect(first.ctx.document).not.toBe(second.ctx.document);
    await first.dispose();
    expect(second.getCRS()).toBeTruthy();
    await second.dispose();
  });
  it('allows a deliberately empty runtime without installing GIS implementations', async () => {
    const map = await Emap.create({ preset: 'empty' });
    expect(inspectContext(map.ctx).map((plugin) => plugin.name)).toEqual(['host.options']);
    expect(!!map.ctx.get('document')).toBe(false);
    await map.dispose();
  });
});
