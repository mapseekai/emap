// Structured result type returned by every `MapshaperOps` method.
//
// Replaces the prior `Promise<boolean>` contract where callers could only
// learn whether an op failed, never why. Each error carries a discriminator
// (`kind`) plus payload fields tailored to that kind so a UI can branch on
// `result.error.kind` and surface a specific message:
//
//   "Layer 'parcels' not found" vs.
//   "Field name contains an illegal '=' character" vs.
//   "Expression evaluation is disabled by `expressionPolicy: 'disabled'`"
//
// `OpResult` keeps the shape stable between sync and async ops; everything
// returns either `OK` (or `okValue(x)` for ops with a payload like
// `checkGeometry`) or a structured error.

/** Categories of failure surfaced by `MapshaperOps` methods. */
export type OpError =
  | { kind: 'not-found'; what: 'source' | 'layer' | 'mask' | 'divider' | 'field'; id: string }
  | { kind: 'validation'; field: string; reason: string }
  | { kind: 'expression-disabled'; operation: string }
  | { kind: 'mapshaper'; cause: unknown; cmd?: string; operation?: string }
  | { kind: 'host-removed' };

/**
 * Sum type returned by every op. `ok: true` carries an optional `value`
 * (most ops have nothing to return; some — like `checkGeometry` — carry
 * a report); `ok: false` carries the structured `error`.
 */
export type OpResult<T = void> = { ok: true; value: T } | { ok: false; error: OpError };

/** Singleton "successful, no payload" result. Cheap to return. */
export const OK: OpResult<void> = Object.freeze({ ok: true, value: undefined });

/** Build a successful result with a payload value. */
export function okValue<T>(value: T): OpResult<T> {
  return { ok: true, value };
}

// -- Error constructors. Tiny helpers so each `return Err.X(...)` site at the
//    op call point reads as a sentence. The shape is verbose deliberately —
//    callers that branch on `result.error.kind` get full type narrowing.

export const Err = Object.freeze({
  notFound(what: 'source' | 'layer' | 'mask' | 'divider' | 'field', id: string): OpResult<never> {
    return { ok: false, error: { kind: 'not-found', what, id } };
  },
  validation(field: string, reason: string): OpResult<never> {
    return { ok: false, error: { kind: 'validation', field, reason } };
  },
  expressionDisabled(operation: string): OpResult<never> {
    return { ok: false, error: { kind: 'expression-disabled', operation } };
  },
  mapshaper(cause: unknown, opts?: { cmd?: string; operation?: string }): OpResult<never> {
    return { ok: false, error: { kind: 'mapshaper', cause, ...(opts ?? {}) } };
  },
  hostRemoved(): OpResult<never> {
    return { ok: false, error: { kind: 'host-removed' } };
  },
});
