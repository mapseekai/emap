import type { EmapHostInternal } from './emap-host';

const operationSignals = new WeakMap<EmapHostInternal, AbortSignal>();

export function operationSignal(host: EmapHostInternal): AbortSignal | undefined {
  return operationSignals.get(host);
}

/** Reuses authoritative state while revoking calls and in-flight commits on feature unload. */
export function scopedOperationHost(host: EmapHostInternal, signal: AbortSignal): EmapHostInternal {
  const parent = operationSignal(host);
  if (parent) signal = AbortSignal.any([parent, signal]);
  const scoped = new Proxy(host, {
    get(target, key, receiver): unknown {
      if (key === '_removed') return signal.aborted || target._removed;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  });
  operationSignals.set(scoped, signal);
  return scoped;
}
