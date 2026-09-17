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
