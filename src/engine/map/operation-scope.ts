import type { EmapHostInternal } from './emap-host';

/** Reuses authoritative state while revoking calls and in-flight commits on feature unload. */
export function scopedOperationHost(host: EmapHostInternal, signal: AbortSignal): EmapHostInternal {
  return new Proxy(host, {
    get(target, key, receiver): unknown {
      if (key === '_removed') return signal.aborted || target._removed;
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value) {
      return Reflect.set(target, key, value);
    },
  });
}
