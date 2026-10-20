import { describe, expect, it, vi } from 'vitest';
import { EditHistory } from '../../../domain/edit/edit-history';
import { EventDispatcher } from '../../core/events';
import { makeStubCtx } from '../../../../test/utils/map-ops';
import { ValidationServiceImpl } from './validation';

describe('ValidationServiceImpl', () => {
  it('reports a rejected validation run through the error event', async () => {
    const events = new EventDispatcher();
    const report = vi.fn();
    events.on('error', report);
    const service = new ValidationServiceImpl({
      document: { _history: new EditHistory(), _removed: false },
      events,
      host: makeStubCtx().ctx.host,
      signal: new AbortController().signal,
    });
    service.validators.register({
      name: 'check',
      phase: 'after-commit',
      run: () => Promise.resolve({ ok: true, issues: [] }),
    });
    const error = new Error('validation failed');
    vi.spyOn(service.validators, 'runFor').mockRejectedValue(error);
    service._runAfterCommitValidators();
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith({ type: 'error', error }));
    service.dispose();
  });
});
