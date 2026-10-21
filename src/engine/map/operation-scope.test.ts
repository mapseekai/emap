import { describe, expect, it } from 'vitest';
import type { EmapHostInternal } from './emap-host';
import { operationSignal, scopedOperationHost } from './operation-scope';

describe('operation cancellation scopes', () => {
  it('keeps nested signals and host removal authoritative without cancelling sibling scopes', () => {
    const host = { _removed: false } as EmapHostInternal;
    const parent = new AbortController();
    const child = new AbortController();
    const sibling = scopedOperationHost(host, new AbortController().signal);
    const nested = scopedOperationHost(scopedOperationHost(host, parent.signal), child.signal);
    expect(operationSignal(nested)?.aborted).toBe(false);
    parent.abort();
    expect(operationSignal(nested)?.aborted).toBe(true);
    expect(nested._removed).toBe(true);
    expect(sibling._removed).toBe(false);
    expect(host._removed).toBe(false);
    Object.assign(host, { _removed: true });
    expect(sibling._removed).toBe(true);
  });
});
