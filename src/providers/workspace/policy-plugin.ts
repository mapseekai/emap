import type { Plugin } from '../../kernel/plugin';
import { EventService, OptionsService, PolicyService } from '../../services/keys';
import { ExpressionPolicyService } from './policy';

export const policyPlugin: Plugin = {
  id: 'provider.policy',
  requires: [EventService, OptionsService],
  provides: [PolicyService],
  setup(ctx) {
    const value = new ExpressionPolicyService({ events: ctx.get(EventService) });
    ctx.provide(PolicyService, value);
    value.setExpressionPolicy(ctx.get(OptionsService).expressionPolicy ?? 'disabled');
  },
};
