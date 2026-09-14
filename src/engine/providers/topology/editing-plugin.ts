import { pluginSignal } from '../../../runtime/context/cancellation';
import { scopedOperationHost } from '../../map/operation-scope';
import type { Plugin } from 'cordis';
import { AttributeOps } from '../../map/attribute-ops';
import { EditSessions } from '../../map/edit-sessions';
export const editSessionsPlugin: Plugin.Object = {
  name: 'feature.edit-sessions',
  inject: ['host'],
  provide: ['editSession'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      const sessions = new EditSessions(scopedOperationHost(ctx.host, signal));
      yield ctx.effect(() => () => sessions.dispose());
      yield ctx.provide('editSession', sessions);
    });
  },
};
export const attributesPlugin: Plugin.Object = {
  name: 'feature.attributes',
  inject: ['host'],
  provide: ['attributes'],
  apply(ctx) {
    const signal = pluginSignal(ctx);
    ctx.effect(function* () {
      yield ctx.provide('attributes', new AttributeOps(scopedOperationHost(ctx.host, signal)));
    });
  },
};
