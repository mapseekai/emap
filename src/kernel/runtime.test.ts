import { describe, expect, it, vi } from 'vitest';
import { EffectScope } from './scope';
import { PluginRuntime } from './runtime';
import { serviceKey, ServiceRegistry } from './service';
import type { Plugin, PluginContext } from './plugin';

const number = serviceKey<number>('test.number');
const text = serviceKey<string>('test.text');
const provider = (value = 1): Plugin => ({
  id: 'number',
  provides: [number],
  setup: (ctx) => ctx.provide(number, value),
});

describe('PluginRuntime', () => {
  it('mounts by declared services, not input order', async () => {
    const runtime = new PluginRuntime();
    runtime.mount([
      {
        id: 'text',
        requires: [number],
        provides: [text],
        setup: (ctx) => ctx.provide(text, String(ctx.get(number))),
      },
      provider(7),
    ]);
    runtime.assertReady();
    expect(runtime.services.get(text)).toBe('7');
    await runtime.dispose();
    expect(runtime.services.list()).toEqual([]);
  });

  it('isolates maps even when tokens are shared across bundles', async () => {
    const a = new PluginRuntime().use(provider(1));
    const b = new PluginRuntime().use(provider(2));
    expect(a.services.get(serviceKey<number>('test.number'))).toBe(1);
    await a.dispose();
    expect(b.services.get(number)).toBe(2);
    await b.dispose();
  });

  it('suspends consumers before providers and restarts after service restoration', async () => {
    const order: string[] = [];
    const runtime = new PluginRuntime();
    runtime.mount([
      {
        id: 'number',
        provides: [number],
        setup: (ctx) => {
          ctx.provide(number, 1);
          ctx.defer(() => {
            order.push('provider');
          });
        },
      },
      {
        id: 'consumer',
        requires: [number],
        setup: (ctx) => {
          order.push(`start:${ctx.get(number)}`);
          ctx.defer(() => {
            order.push('consumer');
          });
        },
      },
    ]);
    runtime.unmount('number');
    expect(order).toEqual(['start:1', 'consumer', 'provider']);
    expect(runtime.inspect()[0]?.status).toBe('waiting');
    runtime.use(provider(2));
    expect(order.at(-1)).toBe('start:2');
    await runtime.dispose();
  });

  it('supports disabling and re-enabling features without removing their definition', async () => {
    const setup = vi.fn();
    const runtime = new PluginRuntime().use({ id: 'feature', setup });
    runtime.disable('feature');
    expect(runtime.inspect()[0]?.status).toBe('disabled');
    runtime.enable('feature');
    expect(setup).toHaveBeenCalledTimes(2);
    await runtime.dispose();
  });

  it('rejects cycles before any effects are installed', () => {
    const setup = vi.fn();
    const runtime = new PluginRuntime();
    expect(() =>
      runtime.mount([
        { id: 'a', provides: [number], requires: [text], setup },
        { id: 'b', provides: [text], requires: [number], setup },
      ]),
    ).toThrow('cycle');
    expect(setup).not.toHaveBeenCalled();
    expect(runtime.inspect()).toEqual([]);
  });

  it('rejects duplicate plugin ids and service providers without disturbing active plugins', async () => {
    const runtime = new PluginRuntime().use(provider());
    expect(() => runtime.use(provider())).toThrow('duplicate plugin');
    expect(() => runtime.use({ ...provider(2), id: 'other' })).toThrow('Multiple providers');
    expect(runtime.services.get(number)).toBe(1);
    await runtime.dispose();
  });

  it('rolls back the entire new mount group on failed activation', async () => {
    const cleanup = vi.fn();
    const runtime = new PluginRuntime().use(provider());
    expect(() =>
      runtime.mount([
        {
          id: 'good',
          provides: [text],
          setup: (ctx) => {
            ctx.provide(text, 'x');
            ctx.defer(cleanup);
          },
        },
        {
          id: 'bad',
          requires: [text],
          setup: () => {
            throw new Error('broken');
          },
        },
      ]),
    ).toThrow('broken');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.services.has(text)).toBe(false);
    expect(runtime.services.get(number)).toBe(1);
    expect(runtime.inspect().map((p) => p.id)).toEqual(['number']);
    await runtime.dispose();
  });

  it('enforces declared consumption and provision', async () => {
    const runtime = new PluginRuntime().use(provider());
    expect(() =>
      runtime.use({
        id: 'read',
        setup: (ctx) => {
          ctx.get(number);
        },
      }),
    ).toThrow('undeclared dependency');
    expect(() =>
      runtime.use({
        id: 'write',
        setup: (ctx) => {
          ctx.provide(text, 'x');
        },
      }),
    ).toThrow('undeclared service');
    expect(() => runtime.use({ id: 'missing', provides: [text], setup: () => {} })).toThrow(
      'did not provide',
    );
    await runtime.dispose();
  });

  it('reports waiting dependencies and prevents use after disposal', async () => {
    const runtime = new PluginRuntime().use({ id: 'waiting', requires: [number], setup: () => {} });
    expect(() => runtime.assertReady()).toThrow('waiting');
    await runtime.dispose();
    expect(() => runtime.use(provider())).toThrow('disposed');
    await runtime.dispose();
  });

  it('rejects access through an obsolete plugin context', async () => {
    let context!: PluginContext;
    const runtime = new PluginRuntime().mount([
      provider(),
      {
        id: 'consumer',
        requires: [number],
        setup: (ctx) => {
          context = ctx;
        },
      },
    ]);
    runtime.unmount('consumer');
    expect(() => context.get(number)).toThrow('disposed');
    await runtime.dispose();
  });

  it('releases unrelated resources even when one cleanup fails', async () => {
    const cleanup = vi.fn();
    const runtime = new PluginRuntime().mount([
      provider(),
      {
        id: 'a',
        setup: (ctx) => {
          ctx.defer(cleanup);
        },
      },
      {
        id: 'b',
        setup: (ctx) => {
          ctx.defer(() => {
            throw new Error('cleanup');
          });
        },
      },
    ]);
    await expect(runtime.dispose()).rejects.toThrow('cleanup failed');
    expect(cleanup).toHaveBeenCalledOnce();
    expect(runtime.services.list()).toEqual([]);
  });
});

describe('EffectScope', () => {
  it('releases in reverse order, once', async () => {
    const calls: number[] = [];
    const scope = new EffectScope();
    const first = scope.defer(() => {
      calls.push(1);
    });
    scope.defer(() => {
      calls.push(2);
    });
    first();
    await scope.dispose();
    await scope.dispose();
    expect(calls).toEqual([1, 2]);
    expect(scope.signal.aborted).toBe(true);
  });

  it('waits for async cleanup and releases late resources immediately', async () => {
    const cleanup = vi.fn();
    const scope = new EffectScope();
    scope.defer(async () => {
      await Promise.resolve();
      cleanup();
    });
    await scope.dispose();
    scope.defer(cleanup);
    await scope.settled();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('does not return async results after its owner was disposed', async () => {
    const scope = new EffectScope();
    let finish!: (value: number) => void;
    const work = scope.run(
      () =>
        new Promise<number>((resolve) => {
          finish = resolve;
        }),
    );
    await scope.dispose();
    finish(10);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('cannot accidentally remove a replacement registration', () => {
    const registry = new ServiceRegistry();
    const release = registry.publish(number, 1, 'a');
    release();
    registry.publish(number, 2, 'b');
    release();
    expect(registry.get(number)).toBe(2);
  });
});
