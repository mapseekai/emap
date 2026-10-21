import { describe, expect, it, vi } from 'vitest';
import { createAbortScope } from './abort-scope';

describe('execution abort scopes', () => {
  it('preserves the first reason and releases every listener on abort', () => {
    const first = new AbortController();
    const second = new AbortController();
    const removals = [first, second].map((source) =>
      vi.spyOn(source.signal, 'removeEventListener'),
    );
    const scope = createAbortScope([first.signal, second.signal]);
    const reason = new Error('first cancellation');
    second.abort(reason);
    first.abort(new Error('later cancellation'));
    expect(scope.signal.reason).toBe(reason);
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
    scope.dispose();
    for (const remove of removals) expect(remove).toHaveBeenCalledOnce();
  });

  it('releases earlier listeners when a later source was already cancelled', () => {
    const first = new AbortController();
    const cancelled = new AbortController();
    const remove = vi.spyOn(first.signal, 'removeEventListener');
    const reason = new Error('already cancelled');
    cancelled.abort(reason);
    const scope = createAbortScope([first.signal, cancelled.signal]);
    expect(scope.signal.reason).toBe(reason);
    expect(remove).toHaveBeenCalledOnce();
  });

  it('detaches after normal settlement and does not subscribe twice to one source', () => {
    const source = new AbortController();
    const add = vi.spyOn(source.signal, 'addEventListener');
    const remove = vi.spyOn(source.signal, 'removeEventListener');
    const scope = createAbortScope([undefined, source.signal, source.signal]);
    expect(add).toHaveBeenCalledOnce();
    scope.dispose();
    scope.dispose();
    expect(remove).toHaveBeenCalledOnce();
    source.abort();
    expect(scope.signal.aborted).toBe(false);
  });
});
