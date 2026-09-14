import { Context, Fiber, Service } from 'cordis';
import { describe, expect, it, vi } from 'vitest';
import { Emap } from '../../../src/engine/map/map';
import {
  contextFibers,
  inspectContext,
  inspectServices,
} from '../../../src/runtime/context/inspection';
import { nativeFiberStates } from '../../../src/runtime/context/state';
import { settleContext } from '../../../src/runtime/context/settle';
import { pluginSignal } from '../../../src/runtime/context/cancellation';
describe('upstream Cordis integration', () => {
  it('activates a waiting consumer and suspends it when its provider disappears', async () => {
    const ctx = new Context();
    const observed: number[] = [];
    const stop = vi.fn();
    const consumer = ctx.plugin({
      name: 'test.consumer',
      inject: ['testNumber'],
      apply(ctx) {
        observed.push(ctx.testNumber);
        ctx.effect(() => stop);
      },
    });
    expect(consumer.state).toBe(nativeFiberStates.PENDING);
    const provider = ctx.plugin({
      name: 'test.provider',
      apply(ctx) {
        ctx.provide('testNumber', 3);
      },
    });
    await settleContext(ctx);
    expect(consumer).toBeInstanceOf(Fiber);
    expect(consumer.state).toBe(nativeFiberStates.ACTIVE);
    expect(observed).toEqual([3]);
    await provider.dispose();
    expect(consumer.state).toBe(nativeFiberStates.PENDING);
    expect(stop).toHaveBeenCalledOnce();
    ctx.plugin({
      name: 'test.replacement',
      apply(ctx) {
        ctx.provide('testNumber', 5);
      },
    });
    await settleContext(ctx);
    expect(observed).toEqual([3, 5]);
    await ctx.fiber.dispose();
    expect(stop).toHaveBeenCalledTimes(2);
  });
  it('accepts native function plugins and Service subclasses without adapters', async () => {
    const ctx = new Context();
    class SampleService extends Service {
      readonly value = 7;
      constructor(ctx: Context) {
        super(ctx, 'testService');
      }
    }
    const service = ctx.plugin(SampleService);
    const value = vi.fn();
    const consumer = Object.assign(
      (ctx: Context) => {
        value(ctx.testService.value);
      },
      { inject: ['testService'] },
    );
    ctx.plugin(consumer);
    await settleContext(ctx);
    expect(value).toHaveBeenCalledWith(7);
    expect(ctx.get('testService')).toBeInstanceOf(SampleService);
    await service.dispose();
    expect(ctx.get('testService')).toBeUndefined();
    await ctx.fiber.dispose();
  });
  it('uses the native effect ordering to stop consumers before closing resources', async () => {
    const ctx = new Context();
    const events: string[] = [];
    ctx.plugin({
      name: 'test.consumer',
      inject: ['testNumber'],
      apply(ctx) {
        ctx.effect(async () => async () => {
          await Promise.resolve();
          events.push('consumer stopped');
        });
      },
    });
    const provider = ctx.plugin({
      name: 'test.provider',
      apply(ctx) {
        ctx.effect(function* () {
          yield () => {
            events.push('resource closed');
          };
          yield ctx.provide('testNumber', 1);
        });
      },
    });
    await settleContext(ctx);
    await provider.dispose();
    expect(events).toEqual(['consumer stopped', 'resource closed']);
    await provider.dispose();
    expect(events).toHaveLength(2);
    await ctx.fiber.dispose();
  });
  it('uses standard Context isolation without a second service registry', async () => {
    const ctx = new Context();
    const a = ctx.isolate('testNumber');
    const b = ctx.isolate('testNumber');
    await a.plugin({
      apply(ctx) {
        ctx.provide('testNumber', 1);
      },
    });
    await b.plugin({
      apply(ctx) {
        ctx.provide('testNumber', 2);
      },
    });
    expect(a.get('testNumber')).toBe(1);
    expect(b.get('testNumber')).toBe(2);
    expect(ctx.get('testNumber')).toBeUndefined();
    await ctx.fiber.dispose();
  });
  it('aborts the old operation lifetime on native restart', async () => {
    const ctx = new Context();
    const signals: AbortSignal[] = [];
    const fiber = ctx.plugin({
      name: 'test.lifetime',
      apply(ctx) {
        signals.push(pluginSignal(ctx));
      },
    });
    await fiber;
    await fiber.restart();
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    await ctx.fiber.dispose();
    expect(signals[1].aborted).toBe(true);
  });
  it('reports real native fibers and service owners without shadow state', async () => {
    const ctx = new Context();
    await ctx.plugin({
      name: 'test.provider',
      apply(ctx) {
        ctx.provide('testNumber', 4);
      },
    });
    expect(inspectContext(ctx)).toMatchObject([
      { name: 'test.provider', state: 'ACTIVE', provides: ['testNumber'] },
    ]);
    expect(inspectServices(ctx)).toContainEqual({
      name: 'testNumber',
      owner: 'test.provider',
      state: 'ACTIVE',
    });
    await ctx.fiber.dispose();
    expect(inspectContext(ctx)).toEqual([]);
  });
});
describe('Cordis-owned GIS workspace', () => {
  it('starts headless with native contexts and no custom runtime API', async () => {
    const map = await Emap.create({ preset: 'headless' });
    expect(Context.is(map.ctx)).toBe(true);
    expect(map).not.toHaveProperty('runtime');
    expect(map).not.toHaveProperty('services');
    expect(map.ctx.document).toBeDefined();
    expect(map.ctx.get('surface')).toBeUndefined();
    expect(map.ctx.get('render')).toBeUndefined();
    expect(contextFibers(map.ctx).every((fiber) => fiber.state === nativeFiberStates.ACTIVE)).toBe(
      true,
    );
    expect(map.capabilities.list().length).toBeGreaterThan(90);
    await map.dispose();
    expect(map.ctx.get('document')).toBeUndefined();
    expect(inspectContext(map.ctx)).toEqual([]);
  });
  it('keeps independent workspaces isolated', async () => {
    const [a, b] = await Promise.all([
      Emap.create({ preset: 'headless' }),
      Emap.create({ preset: 'headless' }),
    ]);
    expect(a.ctx.document).not.toBe(b.ctx.document);
    a.setExpressionPolicy('trusted');
    expect(b.getExpressionPolicy()).toBe('disabled');
    await a.dispose();
    expect(b.getCRS()).toBeTruthy();
    await b.dispose();
  });
  it('supports the standard empty Context composition', async () => {
    const map = await Emap.create({ preset: 'empty' });
    expect(inspectContext(map.ctx).map((fiber) => fiber.name)).toEqual(['host.options']);
    expect(map.ctx.get('document')).toBeUndefined();
    await map.dispose();
  });
});

describe('native failure and resource contracts', () => {
  it('cleans a failed map bootstrap instead of leaving a second runtime alive', async () => {
    const release = vi.fn();
    await expect(
      Emap.create({
        preset: 'headless',
        plugins: [
          {
            name: 'test.failed',
            apply(ctx) {
              ctx.effect(() => release);
              throw new Error('bootstrap failed');
            },
          },
        ],
      }),
    ).rejects.toThrow('bootstrap failed');
    expect(release).toHaveBeenCalledOnce();
  });

  it('cleans providers when required services remain unavailable at bootstrap', async () => {
    const release = vi.fn();
    await expect(
      Emap.create({
        preset: 'empty',
        plugins: [
          {
            name: 'test.resource',
            apply(ctx) {
              ctx.effect(() => release);
            },
          },
          { name: 'test.waiting', inject: ['unavailable'], apply() {} },
        ],
      }),
    ).rejects.toThrow('Plugins not ready: test.waiting');
    expect(release).toHaveBeenCalledOnce();
  });

  it('keeps the active provider when another native fiber collides', async () => {
    const ctx = new Context();
    await ctx.plugin({
      name: 'test.first',
      apply(ctx) {
        ctx.provide('testNumber', 1);
      },
    });
    const second = ctx.plugin({
      name: 'test.second',
      apply(ctx) {
        ctx.provide('testNumber', 2);
      },
    });
    await expect(second.await()).rejects.toThrow('has been registered');
    expect(ctx.get('testNumber')).toBe(1);
    await ctx.fiber.dispose();
  });

  it('supports multiple native fibers of the same plugin with independent config', async () => {
    const ctx = new Context();
    const values: number[] = [];
    const plugin = {
      name: 'test.configured',
      apply(_ctx: Context, config: { value: number }) {
        values.push(config.value);
      },
    };
    const first = await ctx.plugin(plugin, { value: 1 });
    const second = await ctx.plugin(plugin, { value: 2 });
    expect(first.uid).not.toBe(second.uid);
    await first.update({ value: 3 });
    expect(values).toEqual([1, 2, 3]);
    await first.dispose();
    expect(ctx.registry.get(plugin)?.fibers.length).toBe(1);
    await ctx.fiber.dispose();
  });

  it('revokes native event subscriptions with their owner', async () => {
    const ctx = new Context();
    const event = Symbol('event');
    const listener = vi.fn();
    const fiber = await ctx.plugin({
      name: 'test.events',
      apply(ctx) {
        ctx.on(event, listener);
      },
    });
    ctx.emit(event, 1);
    expect(listener).toHaveBeenCalledWith(1);
    await fiber.dispose();
    ctx.emit(event, 2);
    expect(listener).toHaveBeenCalledOnce();
    await ctx.fiber.dispose();
  });

  it('requires inject for hard service access and permits explicit optional lookup', async () => {
    const ctx = new Context();
    await ctx.plugin({
      name: 'test.number',
      apply(ctx) {
        ctx.provide('testNumber', 4);
      },
    });
    const denied = ctx.plugin({
      name: 'test.undeclared',
      apply(ctx) {
        void ctx.testNumber;
      },
    });
    await expect(denied.await()).rejects.toThrow('without inject');
    let observed: number | undefined;
    await ctx.plugin({
      name: 'test.optional',
      apply(ctx) {
        observed = ctx.get('testNumber');
      },
    });
    expect(observed).toBe(4);
    await ctx.fiber.dispose();
  });

  it('waits for asynchronous effect acquisition and disposal', async () => {
    const ctx = new Context();
    const released = vi.fn();
    const fiber = await ctx.plugin({
      name: 'test.async-resource',
      apply(ctx) {
        return ctx.effect(async () => {
          await Promise.resolve();
          return async () => {
            await Promise.resolve();
            released();
          };
        });
      },
    });
    await fiber.dispose();
    expect(released).toHaveBeenCalledOnce();
    await ctx.fiber.dispose();
  });

  it('returns released native effects to the original effect count', async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin({ name: 'test.effects', apply() {} });
    const count = fiber.getEffects().length;
    for (let index = 0; index < 300; index++) {
      const release = fiber.ctx.effect(() => () => {});
      await release();
    }
    expect(fiber.getEffects()).toHaveLength(count);
    await ctx.fiber.dispose();
  });
});

it('cleans earlier native plugins when a later declaration is synchronously invalid', async () => {
  const acquired = vi.fn();
  const released = vi.fn();
  await expect(
    Emap.create({
      preset: 'empty',
      plugins: [
        {
          name: 'test.acquire-before-invalid',
          apply(ctx) {
            acquired();
            ctx.effect(() => released);
          },
        },
        42 as never,
      ],
    }),
  ).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(released.mock.calls.length).toBe(acquired.mock.calls.length);
});
