// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MouseWheel } from './interactions';

describe('wheel zoom frame pacing', () => {
  let now: number;
  let pending: Map<number, FrameRequestCallback>;
  let wheel: MouseWheel;
  let element: HTMLElement;
  let samples: { multiplier: number; direction: number; x: number; y: number }[];

  beforeEach(() => {
    now = 1000;
    pending = new Map();
    let serial = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.set(++serial, callback);
      return serial;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    element = document.createElement('div');
    wheel = new MouseWheel(element);
    samples = [];
    wheel.on('mousewheel', (event) => samples.push(event));
  });

  afterEach(() => {
    wheel.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function input(deltaY = -100): void {
    element.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 240, clientY: 180 }));
  }

  function frame(): void {
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(now);
  }

  it.each([8, 16, 25])('preserves normal %d ms frame speed and the cursor anchor', (interval) => {
    input();
    now += interval;
    frame();
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({ multiplier: interval / 25, direction: 1, x: 240, y: 180 });
  });

  it.each([
    -100, 100,
  ])('does not turn a stalled frame into a catch-up zoom for delta %d', (delta) => {
    input(delta);
    now += 16;
    frame();
    // A large geometry redraw blocks the main thread; another wheel event is
    // delivered before the queued animation callback finally gets to run.
    now += 120;
    input(delta);
    frame();
    expect(samples).toHaveLength(2);
    expect(samples[1].direction).toBe(delta < 0 ? 1 : -1);
    expect(samples[1].multiplier).toBeGreaterThan(0);
    expect(samples[1].multiplier).toBeLessThanOrEqual(1);
    now += 16;
    frame();
    expect(samples[2].multiplier).toBeCloseTo(16 / 25);
  });

  it('still fades and ends a released gesture after a delayed frame', () => {
    const end = vi.fn();
    wheel.on('mousewheelend', end);
    input();
    now += 100;
    frame();
    expect(samples[0].multiplier).toBeGreaterThan(0);
    expect(samples[0].multiplier).toBeLessThan(1);
    now += 60;
    frame();
    expect(end).toHaveBeenCalledOnce();
    expect(samples).toHaveLength(1);
    expect(pending.size).toBe(0);
  });
});
