import { describe, expect, it, vi } from 'vitest';
import { Emap } from '../map/map';
import { duckDbPlugin, DuckDbService } from './plugin';
import { duckDbCapabilityPlugins } from './capabilities';
import { duckDbToolbox } from './toolbox';
import { DuckDbRuntimeScope } from './runtime-scope';
import type { DuckDbRuntime } from './runtime';

function fakeRuntime(): DuckDbRuntime {
  return { connect: vi.fn(), ensureSpatial: vi.fn(), close: vi.fn(async () => {}) };
}

describe('DuckDB provider lifecycle', () => {
  it('lazily provides the entire canonical tool catalog without creating a database', async () => {
    const create = vi.fn(async () => fakeRuntime());
    const map = new Emap({
      preset: 'headless',
      plugins: [duckDbPlugin({ create }), ...duckDbCapabilityPlugins],
    });
    expect(map.capabilities.list().filter((tool) => tool.id.startsWith('duckdb.'))).toHaveLength(
      duckDbToolbox.list().length,
    );
    expect(create).not.toHaveBeenCalled();
    map.runtime.unmount('provider.duckdb');
    expect(map.capabilities.list().filter((tool) => tool.id.startsWith('duckdb.'))).toEqual([]);
    expect(map.capabilities.get('mapshaper.bufferLayer')).toBeDefined();
    await map.dispose();
  });
  it('isolates two databases and does not close borrowed runtimes', async () => {
    const a = fakeRuntime();
    const b = fakeRuntime();
    const first = new Emap({
      preset: 'headless',
      plugins: [duckDbPlugin({ runtime: a, owned: true })],
    });
    const second = new Emap({ preset: 'headless', plugins: [duckDbPlugin({ runtime: b })] });
    expect(await first.getService(DuckDbService).get()).toBe(a);
    expect(await second.getService(DuckDbService).get()).toBe(b);
    await first.dispose();
    await first.dispose();
    expect(a.close).toHaveBeenCalledOnce();
    expect(await second.getService(DuckDbService).get()).toBe(b);
    await second.dispose();
    expect(b.close).not.toHaveBeenCalled();
  });
  it('closes a late runtime after its owner was disposed', async () => {
    const value = fakeRuntime();
    let finish!: (runtime: DuckDbRuntime) => void;
    const scope = new DuckDbRuntimeScope({
      create: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = scope.get();
    await Promise.resolve();
    const stopped = scope.dispose();
    finish(value);
    await expect(pending).rejects.toThrow('disposed');
    await stopped;
    expect(value.close).toHaveBeenCalledOnce();
    await expect(scope.get()).rejects.toThrow('disposed');
  });
  it('shares only initialization within one owner and propagates cleanup failures', async () => {
    const value = fakeRuntime();
    const create = vi.fn(async () => value);
    const scope = new DuckDbRuntimeScope({ create });
    expect(await Promise.all([scope.get(), scope.get()])).toEqual([value, value]);
    expect(create).toHaveBeenCalledOnce();
    vi.mocked(value.close!).mockRejectedValue(new Error('database cleanup failed'));
    await expect(scope.dispose()).rejects.toThrow('database cleanup failed');
  });
});
