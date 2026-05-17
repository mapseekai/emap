// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { FeatureEventDispatcher } from './feature-event-dispatcher';
import type { NormalizedPointerEvent } from './handler';

function ev(kind: 'move' | 'click', x: number, y: number): NormalizedPointerEvent {
  return { kind, point: { x, y }, modifiers: { shift: false, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new Event(kind) };
}

function stubMap(script: Array<Array<{ source: string; layer: string; id: number }>>) {
  let i = 0;
  return {
    queryFeatures: vi.fn(() => script[Math.min(i++, script.length - 1)]),
    unproject: (x: number, y: number) => [x / 10, y / 10] as [number, number],
    features: { get: (ref: any) => ({ ref, geometry: null, properties: Object.freeze({ k: ref.id }) }) },
  };
}

describe('FeatureEventDispatcher', () => {
  it('hasListeners() false until a feature:* listener is added', () => {
    const d = new FeatureEventDispatcher(stubMap([[]]) as any);
    expect(d.hasListeners()).toBe(false);
    d.on('feature:click', undefined, () => {});
    expect(d.hasListeners()).toBe(true);
  });

  it('feature:click fires with ref + frozen feature + lngLat for the topmost hit', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 9 }, { source: 's', layer: 'l', id: 9 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const cb = vi.fn();
    d.on('feature:click', undefined, cb);
    d.dispatch(ev('click', 30, 40));
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e).toMatchObject({ type: 'feature:click', ref: { source: 's', layer: 'l', id: 9 },
      point: { x: 30, y: 40 }, lngLat: [3, 4] });
    expect(e.feature.properties).toEqual({ k: 9 });
    expect(Object.isFrozen(e.feature.properties)).toBe(true);
  });

  it('enter/leave/hover state machine across moves', () => {
    const map = stubMap([
      [{ source: 's', layer: 'l', id: 1 }],
      [{ source: 's', layer: 'l', id: 1 }],
      [{ source: 's', layer: 'l', id: 2 }],
      [],
    ]);
    const d = new FeatureEventDispatcher(map as any);
    const enter = vi.fn(), leave = vi.fn(), hover = vi.fn();
    d.on('feature:enter', undefined, enter);
    d.on('feature:leave', undefined, leave);
    d.on('feature:hover', undefined, hover);
    d.dispatch(ev('move', 0, 0));
    d.dispatch(ev('move', 1, 1));
    d.dispatch(ev('move', 2, 2));
    d.dispatch(ev('move', 3, 3));
    expect(enter.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 2]);
    expect(leave.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 2]);
    expect(hover.mock.calls.map((c) => c[0].ref.id)).toEqual([1, 1, 2]);
  });

  it('per-listener {layers} filter: only matching refs delivered', () => {
    const map = stubMap([[{ source: 's', layer: 'roads', id: 5 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const roads = vi.fn(), water = vi.fn();
    d.on('feature:click', { layers: ['roads'] }, roads);
    d.on('feature:click', { layers: ['water'] }, water);
    d.dispatch(ev('click', 0, 0));
    expect(roads).toHaveBeenCalledTimes(1);
    expect(water).not.toHaveBeenCalled();
    expect(map.queryFeatures).toHaveBeenCalled();
  });

  it('off removes by listener reference (filter stored alongside)', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 1 }]]);
    const d = new FeatureEventDispatcher(map as any);
    const cb = vi.fn();
    d.on('feature:click', { layers: ['l'] }, cb);
    d.off('feature:click', cb);
    d.dispatch(ev('click', 0, 0));
    expect(cb).not.toHaveBeenCalled();
    expect(d.hasListeners()).toBe(false);
  });

  it('empty registry → dispatch is a no-op (no queryFeatures call)', () => {
    const map = stubMap([[{ source: 's', layer: 'l', id: 1 }]]);
    const d = new FeatureEventDispatcher(map as any);
    d.dispatch(ev('click', 0, 0));
    d.dispatch(ev('move', 0, 0));
    expect(map.queryFeatures).not.toHaveBeenCalled();
  });
});
