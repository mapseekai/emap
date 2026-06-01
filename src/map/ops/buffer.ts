// bufferLayer — generate buffer polygons via mapshaper's `-buffer`
// pipeline. Forwards every supported mapshaper option.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { BufferOptions } from '../types';
import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import type { OpContext } from './_context';

const VALID_TYPES = new Set(['left', 'right', 'outer', 'inner']);
const VALID_CAP_STYLES = new Set(['flat', 'round']);
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export async function bufferLayer(ctx: OpContext, opts: BufferOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);

  // radius — required, positive finite number OR non-empty expression.
  // Numeric strings ("5", "-3.2") are also bounds-checked since mapshaper
  // would otherwise accept them and produce empty or undefined buffers.
  if (typeof opts.radius === 'number') {
    if (!Number.isFinite(opts.radius) || opts.radius <= 0) {
      return Err.validation('radius', 'must be a positive finite number');
    }
  } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
    return Err.validation('radius', 'must be a positive number or non-empty expression');
  } else if (NUMERIC_STRING_RE.test(opts.radius) && Number(opts.radius) <= 0) {
    return Err.validation('radius', 'numeric string must be a positive number');
  }
  if (
    typeof opts.radius === 'string' &&
    !ctx.host._allowExpressionEvaluation([opts.radius], 'bufferLayer')
  ) {
    return Err.expressionDisabled('bufferLayer');
  }

  // Numeric performance/quality knobs — all optional, all positive.
  if (opts.vertices !== undefined && !isPositiveInt(opts.vertices)) {
    return Err.validation('vertices', 'must be a positive integer');
  }
  if (opts.arcQuality !== undefined && !isPositiveInt(opts.arcQuality)) {
    return Err.validation('arcQuality', 'must be a positive integer');
  }
  if (opts.sliceLength !== undefined && !isPositiveInt(opts.sliceLength)) {
    return Err.validation('sliceLength', 'must be a positive integer');
  }
  if (opts.backtrack !== undefined && !isPositiveInt(opts.backtrack)) {
    return Err.validation('backtrack', 'must be a positive integer');
  }
  if (opts.tolerance !== undefined && !isPositiveFinite(opts.tolerance)) {
    return Err.validation('tolerance', 'must be a positive finite number');
  }
  if (opts.type !== undefined && !VALID_TYPES.has(opts.type)) {
    return Err.validation('type', `must be one of: left, right, outer, inner`);
  }
  if (opts.capStyle !== undefined && !VALID_CAP_STYLES.has(opts.capStyle)) {
    return Err.validation('capStyle', 'must be one of: flat, round');
  }

  // `type` (left/right/outer/inner) is documented as polyline-only. Warn
  // (don't reject) when used on polygon — mapshaper still accepts it but
  // the output is rarely what the caller wanted.
  if (opts.type !== undefined && layer.geometry_type === 'polygon') {
    console.warn(
      `bufferLayer: type="${opts.type}" is intended for polyline layers; ` +
        `applying to polygon layer "${opts.target}" may produce unexpected output.`,
    );
  }

  // Assemble snake_case option bag. Only include keys the caller actually set.
  const bufferOptions: Record<string, unknown> = { radius: String(opts.radius) };
  if (opts.capStyle !== undefined) bufferOptions.cap_style = opts.capStyle;
  if (opts.vertices !== undefined) bufferOptions.vertices = opts.vertices;
  if (opts.arcQuality !== undefined) bufferOptions.arc_quality = opts.arcQuality;
  if (opts.tolerance !== undefined) bufferOptions.tolerance = opts.tolerance;
  if (opts.type !== undefined) bufferOptions.type = opts.type;
  if (opts.planar === true) bufferOptions.planar = true;
  if (opts.v2 === true) bufferOptions.v2 = true;
  if (opts.sliceLength !== undefined) bufferOptions.slice_length = opts.sliceLength;
  if (opts.backtrack !== undefined) bufferOptions.backtrack = opts.backtrack;

  const commands: ParsedCommand[] = [
    { name: 'target', options: { target: opts.target } },
    { name: 'buffer', options: bufferOptions },
  ];
  return ctx.runDatasetCommandParsed(opts.source, commands, `Buffer ${opts.target}`);
}
