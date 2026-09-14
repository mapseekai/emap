import type { Plugin } from 'cordis';
import { WorkspaceDocument } from './document';
export const documentPlugin: Plugin.Object = {
  name: 'provider.document',
  inject: [],
  provide: ['document'],
  apply(ctx) {
    ctx.effect(function* () {
      const value = new WorkspaceDocument();
      yield ctx.effect(() => () => value.dispose());
      yield ctx.provide('document', value);
    });
  },
};
