import type { Plugin } from '../../kernel/plugin';
import { DocumentService } from '../../services/keys';
import { WorkspaceDocument } from './document';

export const documentPlugin: Plugin = {
  id: 'provider.document',
  requires: [],
  provides: [DocumentService],
  setup(ctx) {
    const value = new WorkspaceDocument();
    ctx.defer(() => value.dispose());
    ctx.provide(DocumentService, value);
  },
};
