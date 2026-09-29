// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installPerformanceMonitor,
  registerPerformanceSource,
  type ExampleRenderMetrics,
} from './performance-monitor';

let callbacks: Map<number, FrameRequestCallback>;
let nextId: number;
let hidden: boolean;
const value = (key: string) => document.querySelector(`[data-metric="${key}"]`)?.textContent;
function frame(time: number): void {
  const current = [...callbacks.values()];
  callbacks.clear();
  for (const callback of current) callback(time);
}
function sample(start = 0): void {
  for (let time = start; time <= start + 1000; time += 20) frame(time);
}

beforeEach(() => {
  document.body.innerHTML = '';
  callbacks = new Map();
  nextId = 0;
  hidden = false;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callbacks.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => callbacks.delete(id));
  vi.stubGlobal('PerformanceObserver', undefined);
});
afterEach(() => {
  installPerformanceMonitor().dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('example performance monitor', () => {
  it('mounts once and measures page FPS independently of an idle map', () => {
    const monitor = installPerformanceMonitor();
    expect(installPerformanceMonitor()).toBe(monitor);
    const read = vi.fn(() => ({ backend: 'WebGL2', frames: 40, drawCalls: 100 }));
    registerPerformanceSource(read);
    sample();
    expect(document.querySelectorAll('.emap-performance')).toHaveLength(1);
    expect(value('fps')).toBe('50.0');
    expect(value('p95')).toBe('20.0 ms');
    expect(value('frames')).toBe('0.0');
    expect(value('calls')).toBe('0.0');
    expect(value('gpu')).toBe('—');
    expect(value('longTasks')).toBe('不支持');
    expect(read).toHaveBeenCalledTimes(2); // registration + one sample, never per frame
  });

  it('uses elapsed time for rates and retains a visible long frame', () => {
    installPerformanceMonitor();
    let metrics: ExampleRenderMetrics = {
      backend: 'WebGPU',
      frames: 10,
      drawCalls: 20,
      uploadedBytes: 0,
    };
    registerPerformanceSource(() => metrics);
    frame(0);
    frame(20);
    metrics = { ...metrics, frames: 14, drawCalls: 28, uploadedBytes: 2 ** 20 };
    frame(2000);
    expect(value('fps')).toBe('1.0');
    expect(value('max')).toBe('1980.0 ms');
    expect(value('p95')).toBe('1980.0 ms');
    expect(value('frames')).toBe('2.0');
    expect(value('calls')).toBe('4.0');
    expect(value('upload')).toBe('512.0 KiB');
  });

  it('handles counter resets, multiple sources and explicit disposal', () => {
    installPerformanceMonitor();
    let a: ExampleRenderMetrics = { backend: 'WebGL2', frames: 100, drawCalls: 500, gpuBytes: 100 };
    const remove = registerPerformanceSource(() => a);
    let alive = true;
    registerPerformanceSource(() => (alive ? { backend: 'WebGPU', gpuBytes: 200 } : null));
    a = { ...a, frames: 1, drawCalls: 2 };
    sample();
    expect(value('frames')).toBe('0.0');
    expect(value('backend')).toBe('WebGL2 + WebGPU');
    remove();
    alive = false;
    sample(1020);
    expect(value('backend')).toBe('未接入地图');
    expect(value('gpu')).toBe('—');
  });

  it('pauses in the background and resets baselines when visible again', () => {
    installPerformanceMonitor();
    let frames = 0;
    registerPerformanceSource(() => ({ backend: 'WebGPU', frames }));
    sample();
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.size).toBe(0);
    expect(value('state')).toBe('已暂停');
    expect(value('fps')).toBe('—');
    frames = 200;
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    sample(20000);
    expect(value('fps')).toBe('50.0');
    expect(value('frames')).toBe('0.0');
    document.querySelector<HTMLButtonElement>('.emap-performance button')!.click();
    expect(callbacks.size).toBe(0);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(callbacks.size).toBe(0); // manual pause survives visibility changes
    document.querySelector<HTMLButtonElement>('.emap-performance button')!.click();
    expect(callbacks.size).toBe(1);
  });

  it('releases sampling on navigation and resumes after a bfcache restore', () => {
    const monitor = installPerformanceMonitor();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    expect(callbacks.size).toBe(0);
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    expect(callbacks.size).toBe(1);
    monitor.dispose();
    expect(callbacks.size).toBe(0);
    expect(document.querySelector('.emap-performance')).toBeNull();
    window.dispatchEvent(new PageTransitionEvent('pageshow'));
    expect(callbacks.size).toBe(0);
  });

  it('observes long tasks only while sampling and reports excess blocking time', () => {
    const observe = vi.fn(),
      disconnect = vi.fn();
    let callback: PerformanceObserverCallback;
    class Observer {
      static supportedEntryTypes = ['longtask'];
      observe = observe;
      disconnect = disconnect;
      takeRecords = () => [];
      constructor(cb: PerformanceObserverCallback) {
        callback = cb;
      }
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    const monitor = installPerformanceMonitor();
    callback!(
      { getEntries: () => [{ duration: 120 }, { duration: 80 }] } as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    sample();
    expect(value('longTasks')).toBe('2.0');
    expect(value('blocking')).toBe('100.0 ms');
    expect(observe).toHaveBeenCalledWith({ type: 'longtask' });
    monitor.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
