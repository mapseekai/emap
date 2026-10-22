import type { EmapHostInternal } from './emap-host';

const scopeSignals = new WeakMap<EmapHostInternal, readonly AbortSignal[]>();

export function operationSignals(host: EmapHostInternal): readonly AbortSignal[] {
  return scopeSignals.get(host) ?? [];
}

/** Reuses authoritative state while revoking calls and in-flight commits on feature unload. */
export function scopedOperationHost(host: EmapHostInternal, signal: AbortSignal): EmapHostInternal {
  const scoped = new Proxy(host, {
    get(target, key, receiver): unknown {
      if (key === '_removed') return signal.aborted || target._removed;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  });
  // Scopes can outlive many operations. Subscribe only while a worker is executing.
  scopeSignals.set(scoped, [...operationSignals(host), signal]);
  return scoped;
}
