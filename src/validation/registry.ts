// Validator registry — owns the set of registered validators and runs
// them at the requested phase.
//
// Design notes:
//
// - Storage is a `Set` keyed on the validator object identity, NOT on
//   `name`. Two validators with the same `name` are allowed (a future
//   extension might want multiple instances of the same family
//   parameterised differently). Callers receive an unregister callback
//   from `register()` — that's the only way to remove a specific
//   validator without unregistering the rest.
//
// - `runFor` runs every matching validator IN PARALLEL via
//   `Promise.allSettled`. A validator that throws is converted to a
//   failed `ValidationReport` so a single broken validator can't take
//   the whole hook chain down.
//
// - The engine hooks into `historychange` and calls `runFor`. If the
//   registry is empty, the call short-circuits (no microtask, no
//   allocations) — paying nothing when no validators are registered
//   is the common case.

import type {
  Validator,
  ValidatorPhase,
  ValidatorResult,
  ValidationReport,
  ValidationChange,
} from './validator';
import type { EmapHostInternal } from '../map/emap-host';

export class ValidatorRegistry {
  private _all = new globalThis.Set<Validator>();

  /** Number of currently registered validators (across all phases). */
  get size(): number {
    return this._all.size;
  }

  /**
   * Register a validator. Returns an unregister callback — call it to
   * remove this exact validator (idempotent).
   */
  register(v: Validator): () => void {
    this._all.add(v);
    return () => {
      this._all.delete(v);
    };
  }

  /** Remove every registered validator. */
  unregisterAll(): void {
    this._all.clear();
  }

  /**
   * Run every validator whose `phase` matches `phase`, in parallel.
   * Validator throws are converted to `severity: 'error'` issues so the
   * caller's hook chain stays predictable.
   *
   * Returns the per-validator results in registration order. Callers
   * typically filter `.report.ok === false` to surface failures.
   */
  async runFor(
    phase: ValidatorPhase,
    host: EmapHostInternal,
    change: ValidationChange,
  ): Promise<ValidatorResult[]> {
    if (this._all.size === 0) return [];
    const candidates: Validator[] = [];
    for (const v of this._all) if (v.phase === phase) candidates.push(v);
    if (candidates.length === 0) return [];

    const settled = await Promise.allSettled(candidates.map((v) => v.run(host, change)));
    const out: ValidatorResult[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const v = candidates[i];
      const s = settled[i];
      let report: ValidationReport;
      if (s.status === 'fulfilled') {
        report = s.value;
      } else {
        report = {
          ok: false,
          issues: [
            {
              severity: 'error',
              message: `validator '${v.name}' threw: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
            },
          ],
        };
      }
      out.push({ validator: v.name, report });
    }
    return out;
  }
}
