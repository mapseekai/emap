import type { Plugin } from '../../kernel/plugin';
import { ExecutionService, OptionsService } from '../../services/keys';
import { ExecutionServiceImpl } from './execution';

export const executionPlugin: Plugin = {
  id: 'provider.execution',
  requires: [OptionsService],
  provides: [ExecutionService],
  setup(ctx) {
    const value = new ExecutionServiceImpl();
    ctx.defer(() => value.dispose());
    ctx.provide(ExecutionService, value);
    value.configure(ctx.get(OptionsService));
  },
};
