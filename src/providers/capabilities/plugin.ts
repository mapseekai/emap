import type { Plugin } from '../../kernel/plugin';
import { CapabilityRegistry } from '../../ai/registry';
import { CapabilityService } from '../../services/capabilities';
import { OptionsService } from '../../services/keys';

export const capabilitiesPlugin: Plugin = {
  id: 'provider.capabilities',
  requires: [OptionsService],
  provides: [CapabilityService],
  setup(ctx) {
    const registry = new CapabilityRegistry(ctx.get(OptionsService).authorizeCapability);
    ctx.defer(() => registry.dispose());
    ctx.provide(CapabilityService, registry);
  },
};
