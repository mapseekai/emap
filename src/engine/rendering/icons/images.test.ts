// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { PointIconImages, type IconAsset } from './images';
const asset = (): IconAsset => ({
  image: {} as ImageBitmap,
  width: 64,
  height: 64,
  bytes: 16384,
  close: vi.fn(),
});
describe('owner-retained point icon images', () => {
  it('deduplicates a URL across styles and layers and releases only the last owner', async () => {
    const image = asset(),
      load = vi.fn(async () => image),
      release = vi.fn();
    const cache = new PointIconImages(vi.fn(), release, vi.fn(), load);
    const a = { url: '/atlas.png', size: 32 },
      b = { url: '/atlas.png', size: 64, rect: [0, 0, 32, 32] as const };
    cache.retain([a, b]);
    await cache.settled();
    expect(load).toHaveBeenCalledOnce();
    expect(cache.get(a)?.asset).toBe(cache.get(b)?.asset);
    for (let i = 0; i < 10; i++) cache.retain([a, b]);
    await cache.settled();
    expect(load).toHaveBeenCalledOnce();
    cache.retain([b]);
    expect(image.close).not.toHaveBeenCalled();
    cache.retain([]);
    expect(image.close).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith(image);
    expect(cache.stats.imageBytes).toBe(0);
    cache.dispose();
  });
  it('closes a late image after cancellation without publishing or invalidating a removed owner', async () => {
    let finish!: (a: IconAsset) => void;
    const invalidate = vi.fn(),
      load = vi.fn(() => new Promise<IconAsset>((r) => (finish = r)));
    const cache = new PointIconImages(invalidate, vi.fn(), vi.fn(), load);
    cache.retain([{ url: '/slow.png' }]);
    await new Promise((r) => setTimeout(r, 5));
    cache.retain([]);
    const image = asset();
    finish(image);
    await cache.settled();
    expect(image.close).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    expect(cache.stats.images).toBe(0);
    cache.dispose();
  });
  it('reports failures once, retains fallback state and supports explicit retry', async () => {
    const report = vi.fn(),
      load = vi.fn().mockRejectedValueOnce(new Error('not found')).mockResolvedValueOnce(asset());
    const cache = new PointIconImages(vi.fn(), vi.fn(), report, load),
      o = { url: '/retry.png' };
    cache.retain([o]);
    await cache.settled();
    expect(cache.get(o)).toBeNull();
    expect(report).toHaveBeenCalledOnce();
    cache.retain([o]);
    await cache.settled();
    expect(load).toHaveBeenCalledOnce();
    cache.retry();
    cache.retain([o]);
    await cache.settled();
    expect(cache.get(o)).not.toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    cache.dispose();
  });
  it('does not admit an over-budget image and does not use an invalid sprite rectangle', async () => {
    const huge = { ...asset(), bytes: 33 * 1024 ** 2 },
      load = vi.fn(async () => huge),
      cache = new PointIconImages(vi.fn(), vi.fn(), vi.fn(), load);
    cache.retain([{ url: '/huge' }]);
    await cache.settled();
    expect(huge.close).toHaveBeenCalledOnce();
    expect(cache.stats.imageBytes).toBe(0);
    cache.dispose();
    const good = new PointIconImages(vi.fn(), vi.fn(), vi.fn(), async () => asset());
    const o = { url: '/sprite', rect: [50, 0, 20, 20] as const };
    good.retain([o]);
    await good.settled();
    expect(good.get(o)).toBeNull();
    expect(good.stats.errors[0]).toContain('bounds');
    good.dispose();
  });
  it('does not fetch more than four images concurrently', async () => {
    let active = 0,
      peak = 0;
    const cache = new PointIconImages(vi.fn(), vi.fn(), vi.fn(), async () => {
      peak = Math.max(peak, ++active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return asset();
    });
    cache.retain(Array.from({ length: 10 }, (_, i) => ({ url: `/icon-${i}.png` })));
    await cache.settled();
    expect(peak).toBe(4);
    expect(cache.stats.images).toBe(10);
    cache.dispose();
  });
});
