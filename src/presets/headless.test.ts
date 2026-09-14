// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Emap } from '../map/map';
import { DocumentService, EventService, RenderService, SurfaceService } from '../services/keys';

describe('headless composition', () => {
  it('mounts a complete document and processing workspace without DOM or Canvas', async () => {
    expect(typeof document).toBe('undefined');
    const map = new Emap({ preset: 'headless' });
    expect(map.services.has(DocumentService)).toBe(true);
    expect(map.services.has(EventService)).toBe(true);
    expect(map.services.has(RenderService)).toBe(false);
    expect(map.services.has(SurfaceService)).toBe(false);
    expect(map.runtime.inspect().every((plugin) => plugin.status === 'active')).toBe(true);
    await map.dispose();
    expect(map.services.list()).toEqual([]);
  });
  it('isolates document and policy state across workspaces', async () => {
    const first = new Emap({ preset: 'headless' });
    const second = new Emap({ preset: 'headless' });
    first.setExpressionPolicy('trusted');
    expect(second.getExpressionPolicy()).toBe('disabled');
    expect(first.services.get(DocumentService)).not.toBe(second.services.get(DocumentService));
    await first.dispose();
    expect(second.getCRS()).toBeTruthy();
    await second.dispose();
  });
  it('allows a deliberately empty runtime without installing GIS implementations', async () => {
    const map = new Emap({ preset: 'empty' });
    expect(map.runtime.inspect().map((plugin) => plugin.id)).toEqual(['host.options']);
    expect(map.services.has(DocumentService)).toBe(false);
    await map.dispose();
  });
});
