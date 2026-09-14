import type { Plugin } from '../../kernel/plugin';
import { OptionsService, SurfaceService } from '../../services/keys';
import { SurfaceServiceImpl } from './surface';

export const surfacePlugin: Plugin = {
  id: 'provider.surface',
  requires: [OptionsService],
  provides: [SurfaceService],
  setup(ctx) {
    const value = new SurfaceServiceImpl();
    ctx.defer(() => value.dispose());
    ctx.provide(SurfaceService, value);
    value.initialize(ctx.get(OptionsService));
  },
};
