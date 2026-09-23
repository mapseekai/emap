import { describe, expect, it, vi } from 'vitest';
import { CanvasRenderService } from './render';

describe('map canvas teardown', () => {
  it('releases backing pixel storage before detaching canvases, even if handles remain reachable', () => {
    const render = new CanvasRenderService({} as never);
    const main = { width: 1920, height: 1080, remove: vi.fn() };
    const overlay = { width: 1920, height: 1080, remove: vi.fn() };
    Reflect.set(render, '_canvas', main);
    Reflect.set(render, '_overlayCanvas', overlay);
    render.dispose();
    expect([main.width, main.height, overlay.width, overlay.height]).toEqual([0, 0, 0, 0]);
    expect(main.remove).toHaveBeenCalledOnce();
    expect(overlay.remove).toHaveBeenCalledOnce();
  });
});

describe('live vertex geometry invalidation', () => {
  it('invalidates only edited source buffers on preview changes, including clearing the preview', () => {
    const arcs = {},
      other = {};
    const state = { mode: 'vertex', vertex: { arcs } };
    const render = new CanvasRenderService({
      editState: { _editState: state },
      document: {
        _sources: new Map([
          ['edited', { getArcs: () => arcs }],
          ['other', { getArcs: () => other }],
        ]),
      },
    } as never);
    const clearGeometryCache = vi.fn();
    Reflect.set(render, '_painter', { clearGeometryCache });
    const sync = () => Reflect.get(render, '_syncLiveEditGeometry').call(render);
    sync();
    sync();
    expect(clearGeometryCache.mock.calls).toEqual([[{ sourceId: 'edited' }]]);
    state.vertex = { arcs };
    sync();
    expect(clearGeometryCache).toHaveBeenCalledTimes(2);
    state.mode = 'none';
    sync();
    sync();
    expect(clearGeometryCache).toHaveBeenCalledTimes(3);
    expect(clearGeometryCache).toHaveBeenLastCalledWith({ sourceId: 'edited' });
  });
});
