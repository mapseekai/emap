import type { Plugin } from '../kernel/plugin';
import { FormatService } from '../services/formats';
import { registerArrowFormats } from './formats';

/** Importing this definition never mounts it or changes another workspace. */
export const arrowFormatsPlugin: Plugin = {
  id: 'feature.format.arrow',
  requires: [FormatService],
  setup(ctx) {
    ctx.defer(registerArrowFormats(ctx.get(FormatService)));
  },
};
