import type { Plugin } from 'cordis';
import { ExpressionPolicyService } from './policy';
export const policyPlugin: Plugin.Object = {
  name: 'provider.policy',
  inject: ['mapEvents', 'options'],
  provide: ['policy'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new ExpressionPolicyService({ events: ctx.mapEvents });
      yield ctx.provide('policy', value);
      value.setExpressionPolicy(ctx.options.expressionPolicy ?? 'disabled');
    });
  },
};
