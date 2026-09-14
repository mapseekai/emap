import { scopedOperationHost } from '../../map/operation-scope';
import type { Plugin } from '../../kernel/plugin';
import { AttributeOps } from '../../map/attribute-ops';
import { EditSessions } from '../../map/edit-sessions';
import { AttributeService, EditSessionService, OperationHostService } from '../../services/keys';

export const editSessionsPlugin: Plugin = {
  id: 'feature.edit-sessions',
  requires: [OperationHostService],
  provides: [EditSessionService],
  setup(ctx) {
    const sessions = new EditSessions(
      scopedOperationHost(ctx.get(OperationHostService), ctx.signal),
    );
    ctx.defer(() => sessions.dispose());
    ctx.provide(EditSessionService, sessions);
  },
};
export const attributesPlugin: Plugin = {
  id: 'feature.attributes',
  requires: [OperationHostService],
  provides: [AttributeService],
  setup(ctx) {
    ctx.provide(
      AttributeService,
      new AttributeOps(scopedOperationHost(ctx.get(OperationHostService), ctx.signal)),
    );
  },
};
