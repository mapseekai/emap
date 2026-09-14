import type { Plugin } from '../../kernel/plugin';
import type { ServiceKey } from '../../kernel/service';
import { ControlsService } from '../../services/keys';
import type { Control } from '../../ui/control';

/** Factory registrations and the controls they create are released together. */
export function controlPlugin(
  id: string,
  create: (options?: unknown) => Control,
  requires: readonly ServiceKey<unknown>[] = [],
): Plugin {
  return {
    id: `feature.control.${id}`,
    requires: [ControlsService, ...requires],
    setup(ctx) {
      ctx.defer(ctx.get(ControlsService).registerFactory(id, create));
    },
  };
}
