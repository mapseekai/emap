import type { Plugin } from 'cordis';
import { type DatasetFormatPlugin } from '../../services/formats';
import { FormatRegistry } from '../../../domain/source/format-registry';
export const formatsPlugin: Plugin.Object = {
  name: 'provider.formats',
  provide: ['formats'],
  apply(ctx) {
    ctx.effect(function* () {
      const formats = new FormatRegistry();
      yield ctx.effect(() => () => formats.dispose());
      yield ctx.provide('formats', formats);
    });
  },
};
/** Turn any codec into an ordinary scoped feature contribution. */
export function formatPlugin(format: DatasetFormatPlugin): Plugin.Object {
  return {
    name: `feature.format.${format.name}`,
    inject: ['formats'],
    apply(ctx) {
      ctx.effect(function* () {
        yield ctx.effect(() => ctx.formats.register(format));
      });
    },
  };
}
