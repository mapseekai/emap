import { describe, expect, it, vi } from 'vitest';
import { PluginRuntime } from './runtime';
import { EffectScope } from './scope';
import { serviceKey } from './service';

const value = serviceKey<number>('regression.value');
const derived = serviceKey<number>('regression.derived');

describe('installation rollback', () => {
  it('restores a pre-existing waiter that failed while a new provider mounted', async () => {
    const runtime = new PluginRuntime();
    runtime.use({
      id: 'consumer',
      requires: [value],
      provides: [derived],
      setup(ctx) {
        const input = ctx.get(value);
        if (input === 1) throw new Error('provider rejected');
        ctx.provide(derived, input * 2);
      },
    });
    expect(() =>
      runtime.use({ id: 'bad-value', provides: [value], setup: (ctx) => ctx.provide(value, 1) }),
    ).toThrow('provider rejected');
    expect(runtime.inspect()).toMatchObject([{ id: 'consumer', status: 'waiting' }]);
    expect(runtime.services.has(value)).toBe(false);
    runtime.use({ id: 'good-value', provides: [value], setup: (ctx) => ctx.provide(value, 3) });
    runtime.assertReady();
    expect(runtime.services.get(derived)).toBe(6);
    await runtime.dispose();
  });

  it('does not leak a plugin mounted reentrantly during failing setup', async () => {
    const runtime = new PluginRuntime();
    expect(() =>
      runtime.use({
        id: 'outer',
        setup() {
          runtime.use({ id: 'nested', setup() {} });
        },
      }),
    ).toThrow('during setup');
    expect(runtime.inspect()).toEqual([]);
    expect(runtime.services.list()).toEqual([]);
    await runtime.dispose();
  });

  it('unwinds already activated old consumers when another new plugin fails', async () => {
    const stopped = vi.fn();
    const runtime = new PluginRuntime().use({
      id: 'consumer',
      requires: [value],
      setup: (ctx) => {
        ctx.defer(stopped);
      },
    });
    expect(() =>
      runtime.mount([
        { id: 'value', provides: [value], setup: (ctx) => ctx.provide(value, 1) },
        {
          id: 'failure',
          requires: [value],
          setup() {
            throw new Error('failure');
          },
        },
      ]),
    ).toThrow('failure');
    expect(runtime.inspect()).toMatchObject([{ id: 'consumer', status: 'waiting' }]);
    expect(runtime.services.has(value)).toBe(false);
    await runtime.dispose();
  });
});

describe('released effects', () => {
  it('does not retain manually released resources for the lifetime of a plugin', async () => {
    const scope = new EffectScope();
    const dispose = vi.fn();
    for (let index = 0; index < 1000; index++) scope.defer(dispose)();
    expect(Reflect.get(scope, 'effects').size).toBe(0);
    await scope.dispose();
    expect(dispose).toHaveBeenCalledTimes(1000);
  });
});
