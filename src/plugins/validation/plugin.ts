import type { Plugin } from '../../kernel/plugin';
import { ValidationService } from '../../services/keys';
import type { Validator } from '../../validation/validator';
import {
  topologyValidator,
  type TopologyValidatorOptions,
} from '../../validation/builtin/topology';

/** Validators are opt-in so a viewer never pays for topology validation on every commit. */
export function validatorPlugin(validator: Validator, id = validator.name): Plugin {
  return {
    id: `feature.validation.${id}`,
    requires: [ValidationService],
    setup(ctx) {
      ctx.defer(ctx.get(ValidationService).validators.register(validator));
    },
  };
}
export function topologyValidationPlugin(options: TopologyValidatorOptions = {}): Plugin {
  return validatorPlugin(topologyValidator(options));
}
