// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { ScrollZoomHandler } from './scroll-zoom';

describe('ScrollZoomHandler', () => {
  it('exposes name "scrollZoom" and is enabled by default', () => {
    const h = new ScrollZoomHandler(document.createElement('div'));
    expect(h.name).toBe('scrollZoom');
    expect(h.isEnabled()).toBe(true);
    h.destroy();
  });

  it('disable() suppresses re-emitted mousewheel events', () => {
    const el = document.createElement('div');
    const h = new ScrollZoomHandler(el);
    const onZoom = vi.fn();
    h.on('mousewheel', onZoom);

    // Re-emit one event while enabled — proves the wiring works (positive control).
    const wheel = Reflect.get(h, '_wheel') as { fire: (e: string, p: unknown) => void };
    wheel.fire('mousewheel', { direction: 1, multiplier: 1, x: 0, y: 0 });
    expect(onZoom).toHaveBeenCalledTimes(1);

    // Now disable and re-emit — gate must suppress it.
    h.disable();
    wheel.fire('mousewheel', { direction: 1, multiplier: 1, x: 0, y: 0 });
    expect(onZoom).toHaveBeenCalledTimes(1); // unchanged
    h.destroy();
  });
});
