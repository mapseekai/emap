import type { Plugin } from '../../kernel/plugin';
import {
  DocumentService,
  EventService,
  OperationHostService,
  ValidationService,
} from '../../services/keys';
import { ValidationServiceImpl } from './validation';

export const validationPlugin: Plugin = {
  id: 'provider.validation',
  requires: [DocumentService, EventService, OperationHostService],
  provides: [ValidationService],
  setup(ctx) {
    const value = new ValidationServiceImpl({
      document: ctx.get(DocumentService),
      events: ctx.get(EventService),
      host: ctx.get(OperationHostService),
      signal: ctx.signal,
    });
    ctx.defer(() => value.dispose());
    ctx.provide(ValidationService, value);
    const events = ctx.get(EventService);
    const onHistory = () => value._runAfterCommitValidators();
    events.on('historychange', onHistory);
    ctx.defer(() => {
      events.off('historychange', onHistory);
    });
  },
};
