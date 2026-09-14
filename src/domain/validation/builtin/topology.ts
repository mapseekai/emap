// topologyValidator — built-in validator that flags self-intersections
// across one or more sources via the same primitive `checkGeometry` ops
// uses (`adapter.findSegmentIntersections`).
//
// Use case: editors that allow free-form vertex drags want a passive
// "you just broke topology" warning without forcing the user to invoke
// `checkGeometry` manually.

import { getDefaultMapshaperAdapter } from '../../../integrations/mapshaper/adapter';
import type { Validator, ValidationIssue } from '../validator';

export interface TopologyValidatorOptions {
  /**
   * Limit the validator to these source ids. If omitted, runs over
   * every registered source. Useful when a workflow has a "scratchpad"
   * source where intersections are temporarily expected.
   */
  sources?: string[];
  /** Tolerance forwarded to `findSegmentIntersections`. */
  tolerance?: number;
  /** Severity of reported issues. Defaults to `'error'`. */
  severity?: ValidationIssue['severity'];
}

/**
 * Construct a `Validator` that scans listed sources for arc
 * self-intersections after every commit. Failures appear in the
 * `validationfailed` event payload as one issue per offending source.
 */
export function topologyValidator(opts: TopologyValidatorOptions = {}): Validator {
  const severity = opts.severity ?? 'error';
  return {
    name: 'topology',
    phase: 'after-commit',
    async run(host) {
      const adapter = getDefaultMapshaperAdapter();
      const sourceIds = opts.sources ?? Array.from(host._sources.keys());
      const issues: ValidationIssue[] = [];
      for (const sid of sourceIds) {
        const ds = host._sources.get(sid)?.getDataset();
        if (!ds || !ds.arcs) continue;
        const internalOpts: { tolerance?: number } = {};
        if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;
        const hits = adapter.findSegmentIntersections(ds.arcs, internalOpts);
        if (hits.length > 0) {
          issues.push({
            severity,
            message: `${sid}: ${hits.length} self-intersection${hits.length === 1 ? '' : 's'}`,
          });
        }
      }
      return { ok: issues.length === 0, issues };
    },
  };
}
