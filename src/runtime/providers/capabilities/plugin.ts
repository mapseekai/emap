import type { Plugin } from 'cordis';
import { CapabilityRegistry } from '../../ai/registry';
export const capabilitiesPlugin: Plugin.Object = {
  name: 'provider.capabilities',
  inject: ['options'],
  provide: ['capabilities'],
  apply(ctx) {
    ctx.effect(function* () {
      const registry = new CapabilityRegistry(ctx.options.authorizeCapability);
      yield ctx.effect(() => () => registry.dispose());
      yield ctx.provide('capabilities', registry);
    });
  },
};
