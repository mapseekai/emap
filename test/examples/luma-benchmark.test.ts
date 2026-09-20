import { afterEach, describe, expect, it, vi } from 'vitest';
import { AffineTransform } from '../../src/domain/geo/transform';
import { generateScene, vectorScene } from '../../packages/examples/src/luma-benchmark/scene';
import {
  animationTick,
  navigationFrame,
  summarize,
} from '../../packages/examples/src/luma-benchmark/metrics';

afterEach(() => vi.unstubAllGlobals());
describe('standalone luma benchmark', () => {
  it('builds deterministic mapshaper point datasets without a GeoJSON intermediate', async () => {
    const signal = new AbortController().signal;
    const a = await generateScene('point', 20, signal);
    const b = await generateScene('point', 20, signal);
    expect(a.dataset.layers[0].shapes).toEqual(b.dataset.layers[0].shapes);
    expect(a.featureCount).toBe(20);
    expect(a.vertexCount).toBe(20);
    expect(a.bounds.xmin).toBeGreaterThanOrEqual(13_000_000);
  });
  it('keeps polygon rings and holes in mapshaper arc topology', async () => {
    const scene = await generateScene('polygon', 8, new AbortController().signal);
    expect(scene.dataset.arcs?.size()).toBeGreaterThan(0);
    expect(scene.dataset.layers[0].shapes?.[0]).toHaveLength(2);
    expect(scene.featureCount).toBe(8);
    expect(scene.vertexCount).toBeGreaterThan(24);
  });
  it('validates count and stops an already cancelled build', async () => {
    const controller = new AbortController();
    await expect(generateScene('point', Infinity, controller.signal)).rejects.toThrow('Invalid');
    controller.abort();
    await expect(generateScene('polyline', 1000, controller.signal)).rejects.toThrow();
  });
  it('does not mutate an imported dataset during validation', () => {
    const dataset = {
      layers: [{ geometry_type: 'point' as const, shapes: [[[5, 6] as [number, number]]] }],
    };
    const snapshot = JSON.stringify(dataset);
    const scene = vectorScene(dataset, 'same-source');
    expect(scene.dataset).toBe(dataset);
    expect(JSON.stringify(dataset)).toBe(snapshot);
    expect(() => vectorScene({ layers: [] }, 'empty')).toThrow('no finite');
  });
  it('reports frame cadence separately from CPU time and uses nearest-rank P95', () => {
    const result = summarize({ cpuMs: [1, 2, 3, 4], frameMs: [10, 10, 20, 40] });
    expect(result).toEqual({
      samples: 4,
      cpuMeanMs: 2.5,
      cpuP95Ms: 4,
      frameMeanMs: 20,
      frameP95Ms: 40,
      fps: 50,
      framesOver33ms: 1,
    });
    expect(summarize({ cpuMs: [], frameMs: [] }).fps).toBeNull();
  });
  it('uses identical trajectories for both backends without modifying the start transform', () => {
    const base = new AffineTransform(2, -2, 40, 60);
    const snapshot = base.clone();
    const a = navigationFrame(base, 15, 60, 800, 600);
    const b = navigationFrame(base, 15, 60, 800, 600);
    expect(a).toEqual(b);
    expect(base).toEqual(snapshot);
    expect(navigationFrame(base, 0, 60, 800, 600)).toEqual(base);
  });
  it('cancels a queued animation callback instead of leaving the run unresolved', async () => {
    const cancel = vi.fn();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 42),
    );
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const controller = new AbortController();
    const pending = animationTick(controller.signal);
    controller.abort(new Error('stopped'));
    await expect(pending).rejects.toThrow('stopped');
    expect(cancel).toHaveBeenCalledWith(42);
  });
});
