import type { Plugin } from 'cordis';
import { ExecutionServiceImpl } from './execution';
export const executionPlugin: Plugin.Object = {
  name: 'provider.execution',
  inject: ['options'],
  provide: ['execution'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new ExecutionServiceImpl();
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('execution', value);
      value.configure(ctx.options);
    });
  },
};
