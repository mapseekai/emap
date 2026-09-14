import type { Context } from 'cordis';
import type { Plugin } from 'cordis';
import type { Control } from '../../../ui/control';
/** Factory registrations and the controls they create are released together. */
export function controlPlugin(
  id: string,
  create: (options?: unknown) => Control,
  requires: readonly (keyof Context & string)[] = [],
): Plugin.Object {
  return {
    name: `feature.control.${id}`,
    inject: ['controls', ...requires],
    apply(ctx) {
      ctx.effect(function* () {
        yield ctx.effect(() => ctx.controls.registerFactory(id, create));
      });
    },
  };
}
