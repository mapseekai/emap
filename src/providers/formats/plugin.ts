import type { Plugin } from '../../kernel/plugin';
import { FormatService, type DatasetFormatPlugin } from '../../services/formats';
import { FormatRegistry } from '../../source/format-registry';

export const formatsPlugin: Plugin = {
  id: 'provider.formats',
  provides: [FormatService],
  setup(ctx) {
    const formats = new FormatRegistry();
    ctx.defer(() => formats.dispose());
    ctx.provide(FormatService, formats);
  },
};

/** Turn any codec into an ordinary scoped feature contribution. */
export function formatPlugin(format: DatasetFormatPlugin): Plugin {
  return {
    id: `feature.format.${format.name}`,
    requires: [FormatService],
    setup(ctx) {
      ctx.defer(ctx.get(FormatService).register(format));
    },
  };
}
