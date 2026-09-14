import { describe, expect, it } from 'vitest';
import { PluginRuntime } from './runtime';
import { serviceKey } from './service';

const backend = serviceKey<number>('test.optional-backend');
const reader = serviceKey<() => number | undefined>('test.optional-reader');

describe('optional service lookup', () => {
  it('does not block startup and sees a provider mounted later', async () => {
    const runtime = new PluginRuntime().use({
      id: 'reader',
      optional: [backend],
      provides: [reader],
      setup(ctx) {
        ctx.provide(reader, () => ctx.optional(backend));
      },
    });
    runtime.assertReady();
    expect(runtime.services.get(reader)()).toBeUndefined();
    runtime.use({ id: 'backend', provides: [backend], setup: (ctx) => ctx.provide(backend, 4) });
    expect(runtime.services.get(reader)()).toBe(4);
    runtime.disable('backend');
    runtime.assertReady();
    expect(runtime.services.get(reader)()).toBeUndefined();
    await runtime.dispose();
  });
  it('rejects undeclared optional lookup', async () => {
    const runtime = new PluginRuntime();
    expect(() =>
      runtime.use({
        id: 'bad',
        setup(ctx) {
          ctx.optional(backend);
        },
      }),
    ).toThrow('undeclared optional');
    expect(runtime.inspect()).toEqual([]);
    await runtime.dispose();
  });
  it('stops optional consumers before their provider', async () => {
    const order: string[] = [];
    const runtime = new PluginRuntime().mount([
      {
        id: 'reader',
        optional: [backend],
        setup(ctx) {
          ctx.defer(() => {
            order.push('reader');
          });
        },
      },
      {
        id: 'backend',
        provides: [backend],
        setup(ctx) {
          ctx.provide(backend, 4);
          ctx.defer(() => {
            order.push('backend');
          });
        },
      },
    ]);
    await runtime.dispose();
    expect(order).toEqual(['reader', 'backend']);
  });
});
