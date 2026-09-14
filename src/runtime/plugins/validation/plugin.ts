import type { Plugin } from 'cordis';
import type { Validator } from '../../../domain/validation/validator';
import {
  topologyValidator,
  type TopologyValidatorOptions,
} from '../../../domain/validation/builtin/topology';
/** Validators are opt-in so a viewer never pays for topology validation on every commit. */
export function validatorPlugin(validator: Validator, id = validator.name): Plugin.Object {
  return {
    name: `feature.validation.${id}`,
    inject: ['validation'],
    apply(ctx) {
      ctx.effect(function* () {
        yield ctx.effect(() => ctx.validation.validators.register(validator));
      });
    },
  };
}
export function topologyValidationPlugin(options: TopologyValidatorOptions = {}): Plugin.Object {
  return validatorPlugin(topologyValidator(options));
}
