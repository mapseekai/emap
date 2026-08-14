// defineLayerOp — descriptor factory for single-target layer ops.
//
// Most op bodies are the same skeleton: resolve source/dataset/target,
// optional geometry precondition, optional expression-policy gate,
// per-op validation, snake_case option-bag assembly, then one
// `runDatasetCommandParsed` call. Only the variable parts differ per op.
// This factory owns the skeleton once; each migrated op declares its
// variables as a {@link LayerOpSpec}.
//
// Hook execution order (error precedence is load-bearing — tests assert
// exact Err kinds/fields):
//
//   1. `preResolve`   — validation that must precede source resolution
//   2. resolve source → dataset → target (skipped when target omitted
//      and `target: 'optional'`)
//   3. `geometry`     — declarative target-layer geometry precondition
//   4. `preGate`      — validation that must precede the expression gate
//   5. expression gate — `expressions` via host._allowExpressionEvaluation
//   6. `validate`     — remaining validation (mask/divider resolution,
//      type-dependent geometry rules, collisions, …)
//   7. `options`      — assemble the snake_case option bag
//   8. run `[target?] + [command]` via ctx.runDatasetCommandParsed
//
// The emitted `ParsedCommand[]`, error kinds/fields, and label strings are
// byte-identical to the hand-written bodies, so the worker path,
// `inferEffectForHeads` classification, undo history, and selection
// preservation are all unaffected. Ops whose lifecycle does not fit the
// skeleton (project/check-geometry/join-table/mergeSelected/…) stay
// hand-written — do not force-fit the descriptor.

import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { MapshaperDataset, MapshaperLayer } from '../../types/mapshaper-types';
import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { OpContext } from './_context';

export interface LayerOpSpec<O extends { source: string; target?: string }> {
  /** Exported op function name, echoed in expression-policy errors. */
  name: string;
  /** mapshaper command head (feeds heads → COMMAND_EFFECTS in _runner). */
  command: string;
  /** History/undo label, e.g. `(o) => \`Explode ${o.target}\``. */
  label: (opts: O) => string;
  /**
   * 'required' (default) resolves the target layer and emits `-target`;
   * 'optional' skips both when `opts.target` is undefined (mapshaper CLI
   * default: whole dataset).
   */
  target?: 'required' | 'optional';
  /**
   * Declarative geometry precondition on the resolved target layer.
   * Type-dependent rules (e.g. `-points` per-type geometry) belong in
   * `validate` instead.
   */
  geometry?: 'polygon' | 'polyline';
  /** Validation that must run BEFORE source resolution (step 1). */
  preResolve?: (opts: O) => OpResult | void;
  /** Validation after resolution, BEFORE the expression gate (step 4). */
  preGate?: (
    opts: O,
    layer: MapshaperLayer | undefined,
    dataset: MapshaperDataset,
  ) => OpResult | void;
  /** Expressions gated through host._allowExpressionEvaluation (step 5). */
  expressions?: (opts: O) => Array<string | undefined>;
  /** Validation after the expression gate (step 6). */
  validate?: (
    opts: O,
    layer: MapshaperLayer | undefined,
    dataset: MapshaperDataset,
  ) => OpResult | void;
  /** snake_case option bag for the command (step 7). */
  options: (opts: O, layer: MapshaperLayer | undefined) => Record<string, unknown>;
}

export function defineLayerOp<O extends { source: string; target?: string }>(
  spec: LayerOpSpec<O>,
): (ctx: OpContext, opts: O) => Promise<OpResult> {
  return async (ctx, opts) => {
    const early = spec.preResolve?.(opts);
    if (early) return early;

    const source = ctx.host._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);

    let layer: MapshaperLayer | undefined;
    if (spec.target !== 'optional' || opts.target !== undefined) {
      layer = resolveLayerInList(dataset.layers, opts.target!) ?? undefined;
      if (!layer) return Err.notFound('layer', opts.target!);
    }
    if (layer && spec.geometry && layer.geometry_type !== spec.geometry) {
      return Err.validation(
        'target',
        `expected ${spec.geometry} layer, got ${layer.geometry_type ?? 'unknown'}`,
      );
    }

    const preGate = spec.preGate?.(opts, layer, dataset);
    if (preGate) return preGate;

    const expressions = spec.expressions?.(opts);
    if (expressions && !ctx.host._allowExpressionEvaluation(expressions, spec.name)) {
      return Err.expressionDisabled(spec.name);
    }

    const invalid = spec.validate?.(opts, layer, dataset);
    if (invalid) return invalid;

    const commands: ParsedCommand[] = [];
    if (opts.target !== undefined) {
      commands.push({ name: 'target', options: { target: opts.target } });
    }
    commands.push({ name: spec.command, options: spec.options(opts, layer) });
    return ctx.runDatasetCommandParsed(opts.source, commands, spec.label(opts));
  };
}
