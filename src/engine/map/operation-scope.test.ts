import { describe, expect, it, vi } from 'vitest';
import type { EmapHostInternal } from './emap-host';
import { operationSignals, scopedOperationHost } from './operation-scope';

describe('operation cancellation scopes', () => {
  it('creates nested scopes without AbortSignal.any or persistent abort listeners', () => {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any')!;
    Object.defineProperty(AbortSignal, 'any', { ...descriptor, value: undefined });
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    try {
      const host = { _removed: false } as EmapHostInternal;
      const nested = scopedOperationHost(
        scopedOperationHost(host, controller.signal),
        new AbortController().signal,
      );
      expect(nested._removed).toBe(false);
      controller.abort();
      expect(nested._removed).toBe(true);
      expect(add).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(AbortSignal, 'any', descriptor);
    }
  });
  it('keeps nested signals and host removal authoritative without cancelling sibling scopes', () => {
    const host = { _removed: false } as EmapHostInternal;
    const parent = new AbortController();
    const child = new AbortController();
    const sibling = scopedOperationHost(host, new AbortController().signal);
    const nested = scopedOperationHost(scopedOperationHost(host, parent.signal), child.signal);
    expect(operationSignals(nested).some((signal) => signal.aborted)).toBe(false);
    parent.abort();
    expect(operationSignals(nested).some((signal) => signal.aborted)).toBe(true);
    expect(nested._removed).toBe(true);
    expect(sibling._removed).toBe(false);
    expect(host._removed).toBe(false);
    Object.assign(host, { _removed: true });
    expect(sibling._removed).toBe(true);
  });
});
