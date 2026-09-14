import type { Plugin } from 'cordis';
import { registerArrowFormats } from './formats';
/** Importing this definition never mounts it or changes another workspace. */
export const arrowFormatsPlugin: Plugin.Object = {
  name: 'feature.format.arrow',
  inject: ['formats'],
  apply(ctx) {
    ctx.effect(function* () {
      yield ctx.effect(() => registerArrowFormats(ctx.formats));
    });
  },
};
