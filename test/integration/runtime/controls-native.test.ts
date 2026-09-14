// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createTestMap } from '../../utils/plugin-test-map';
import { settleContext } from '../../../src/runtime/context/settle';
import type { Control } from '../../../src/ui/control';

it('suspends and restores a control through native inject without leaking ownership', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const map = await createTestMap();
  map.ctx.surface._controlContainers.set('top-left', container);
  const provider = {
    name: 'test.control-provider',
    apply(ctx: import('cordis').Context) {
      ctx.provide('testControlDependency', {});
    },
  };
  const fiber = await map.ctx.plugin(provider);
  const onAdd = vi.fn(() => {
    const node = document.createElement('div');
    node.dataset.testControl = 'true';
    return node;
  });
  const onRemove = vi.fn();
  const control: Control = { inject: ['testControlDependency'], onAdd, onRemove };
  await map.addControl(control);
  expect(container.querySelectorAll('[data-test-control]')).toHaveLength(1);
  await fiber.dispose();
  expect(onRemove).toHaveBeenCalledOnce();
  expect(container.querySelectorAll('[data-test-control]')).toHaveLength(0);
  await map.ctx.plugin(provider);
  await settleContext(map.ctx);
  expect(onAdd).toHaveBeenCalledTimes(2);
  expect(container.querySelectorAll('[data-test-control]')).toHaveLength(1);
  await map.removeControl(control);
  expect(container.querySelectorAll('[data-test-control]')).toHaveLength(0);
  await map.dispose();
  expect(onRemove).toHaveBeenCalledTimes(2);
  container.remove();
});
