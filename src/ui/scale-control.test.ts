// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScaleControl } from './scale-control';

const metrics = {
  metersPerPixel: 2,
  scaleDenominator: 7559.055,
  calculationMethod: 'center' as const,
  zoom: 12.25,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function stubMap(result: Promise<typeof metrics | null>) {
  const listeners: Record<string, Function[]> = {};
  return {
    on: vi.fn((type: string, callback: Function) => {
      (listeners[type] ??= []).push(callback);
    }),
    off: vi.fn((type: string, callback: Function) => {
      listeners[type] = (listeners[type] ?? []).filter((registered) => registered !== callback);
    }),
    getScaleMetrics: vi.fn(() => result),
    _emit: (type: string) => (listeners[type] ?? []).forEach((callback) => callback()),
    _count: (type: string) => (listeners[type] ?? []).length,
  };
}

describe('ScaleControl', () => {
  let frames: FrameRequestCallback[];
  let cancelAnimationFrame: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    frames = [];
    let frameId = 0;
    cancelAnimationFrame = vi.fn((id: number) => {
      frames[id - 1] = undefined as unknown as FrameRequestCallback;
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback);
      frameId += 1;
      return frameId;
    }));
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function flushFrame(): Promise<void> {
    const callback = frames.shift();
    callback?.(0);
    await Promise.resolve();
    await Promise.resolve();
  }

  it('exports ScaleControl from the package entry point', async () => {
    const api = await import('../index');

    expect(api.ScaleControl).toBe(ScaleControl);
  });

  it('subscribes through the Emap lifecycle and renders a metric scale reading', async () => {
    const map = stubMap(Promise.resolve(metrics));
    const control = new ScaleControl();
    const root = control.onAdd(map as any);

    expect(map.on).toHaveBeenCalledWith('move', expect.any(Function));
    expect(map.on).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(map.on).toHaveBeenCalledWith('crschange', expect.any(Function));
    expect(root.getAttribute('aria-live')).toBe('polite');
    expect(root.querySelector('.emap-scale-summary')).toBeTruthy();
    expect(root.querySelector('.emap-scale-labels')).toBeTruthy();
    expect(root.querySelector('.emap-scale-bar')).toBeTruthy();

    await flushFrame();

    expect(root.textContent).toContain('1:7,559');
    expect(root.textContent).toContain('Zoom 12.25');
    const labels = root.querySelectorAll('.emap-scale-labels > span');
    expect(labels).toHaveLength(3);
    expect([...labels].map((label) => label.textContent)).toEqual(['0', '100 m', '200 m']);
    expect(Number.parseFloat(root.style.getPropertyValue('--emap-scale-width'))).toBeLessThanOrEqual(140);
    expect(root.querySelectorAll('.emap-scale-segment')).toHaveLength(4);
  });

  it.each([
    ['metric', '200 m'],
    ['imperial', '656 ft'],
    ['dual', '200 m / 656 ft'],
  ] as const)('renders %s distance labels', async (units, expected) => {
    const map = stubMap(Promise.resolve(metrics));
    const root = new ScaleControl({ units }).onAdd(map as any);

    await flushFrame();

    expect(root.querySelector('.emap-scale-labels')?.textContent).toContain(expected);
  });

  it('honors showScale and showZoom independently', async () => {
    const map = stubMap(Promise.resolve(metrics));
    const root = new ScaleControl({ showScale: false, showZoom: false }).onAdd(map as any);

    await flushFrame();

    expect(root.querySelector('.emap-scale-summary')?.textContent).toBe('');
    expect(root.querySelector('.emap-scale-labels')?.textContent).toBe('');
    expect((root.querySelector('.emap-scale-bar') as HTMLElement).hidden).toBe(true);
  });

  it('hides when metrics are unavailable', async () => {
    const map = stubMap(Promise.resolve(null));
    const root = new ScaleControl().onAdd(map as any);

    await flushFrame();

    expect(root.hidden).toBe(true);
  });

  it('hides a previous reading when a non-Earth CRS has no metrics', async () => {
    const map = stubMap(Promise.resolve(metrics));
    map.getScaleMetrics.mockReturnValueOnce(Promise.resolve(metrics)).mockReturnValueOnce(Promise.resolve(null));
    const root = new ScaleControl().onAdd(map as any);
    await flushFrame();

    map._emit('crschange');
    await flushFrame();

    expect(root.hidden).toBe(true);
    expect(root.querySelector('.emap-scale-summary')?.textContent).toBe('');
    expect(root.querySelector('.emap-scale-labels')?.textContent).toBe('');
  });

  it('coalesces consecutive move events into one animation frame', () => {
    const map = stubMap(Promise.resolve(metrics));
    new ScaleControl().onAdd(map as any);

    map._emit('move');
    map._emit('move');

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
  });

  it('clears stale content immediately on crschange', async () => {
    const map = stubMap(Promise.resolve(metrics));
    const root = new ScaleControl().onAdd(map as any);
    await flushFrame();

    map._emit('crschange');

    expect(root.hidden).toBe(true);
    expect(root.querySelector('.emap-scale-summary')?.textContent).toBe('');
    expect(root.querySelector('.emap-scale-labels')?.textContent).toBe('');
  });

  it('detaches every map listener and cancels a queued frame on removal', () => {
    const map = stubMap(Promise.resolve(metrics));
    const control = new ScaleControl();
    const root = control.onAdd(map as any);
    document.body.append(root);

    control.onRemove();

    expect(map.off).toHaveBeenCalledWith('move', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(map.off).toHaveBeenCalledWith('crschange', expect.any(Function));
    expect(map._count('move')).toBe(0);
    expect(map._count('resize')).toBe(0);
    expect(map._count('crschange')).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(root.isConnected).toBe(false);
  });

  it('ignores a stale metrics request that resolves after a newer request', async () => {
    const first = deferred<typeof metrics | null>();
    const second = deferred<typeof metrics | null>();
    const map = stubMap(first.promise);
    map.getScaleMetrics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const root = new ScaleControl().onAdd(map as any);

    await flushFrame();
    map._emit('move');
    await flushFrame();
    second.resolve({ ...metrics, scaleDenominator: 2500, zoom: 8 });
    await Promise.resolve();
    await Promise.resolve();
    first.resolve(metrics);
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('.emap-scale-summary')?.textContent).toContain('1:2,500');
    expect(root.querySelector('.emap-scale-summary')?.textContent).toContain('Zoom 8');
    expect(root.querySelector('.emap-scale-summary')?.textContent).not.toContain('1:7,559');
  });

  it('invalidates a pending request when a newer frame is scheduled', async () => {
    const stale = deferred<typeof metrics | null>();
    const next = deferred<typeof metrics | null>();
    const map = stubMap(Promise.resolve(metrics));
    map.getScaleMetrics
      .mockReturnValueOnce(Promise.resolve(metrics))
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(next.promise);
    const root = new ScaleControl().onAdd(map as any);
    await flushFrame();
    expect(root.querySelector('.emap-scale-summary')?.textContent).toContain('1:7,559');

    map._emit('move');
    await flushFrame();
    map._emit('move');
    stale.resolve({ ...metrics, scaleDenominator: 2500, zoom: 8 });
    await Promise.resolve();
    await Promise.resolve();

    expect(root.querySelector('.emap-scale-summary')?.textContent).toContain('1:7,559');
    expect(root.querySelector('.emap-scale-summary')?.textContent).not.toContain('1:2,500');
  });
});
