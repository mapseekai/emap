import type { Plugin } from '../../kernel/plugin';
import { ScaleService, ViewService } from '../../services/keys';
import { ScaleServiceImpl } from './scale';

export const scalePlugin: Plugin = {
  id: 'provider.scale',
  requires: [ViewService],
  provides: [ScaleService],
  setup(ctx) {
    const value = new ScaleServiceImpl({ view: ctx.get(ViewService) });
    ctx.provide(ScaleService, value);
  },
};
