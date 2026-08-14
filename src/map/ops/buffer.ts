// bufferLayer — generate buffer polygons via mapshaper's `-buffer`
// pipeline. Forwards every supported mapshaper option.

import { Err } from '../op-result';
import type { BufferOptions } from '../types';
import { defineLayerOp } from './_define';

const VALID_TYPES = new Set(['left', 'right', 'outer', 'inner']);
const VALID_CAP_STYLES = new Set(['flat', 'round']);
const NUMERIC_STRING_RE = /^-?\d+(\.\d+)?$/;

function isPositiveInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

export const bufferLayer = defineLayerOp<BufferOptions>({
  name: 'bufferLayer',
  command: 'buffer',
  label: (o) => `Buffer ${o.target}`,
  preGate: (o) => {
    // radius — required, positive finite number OR non-empty expression.
    // Numeric strings ("5", "-3.2") are also bounds-checked since mapshaper
    // would otherwise accept them and produce empty or undefined buffers.
    if (typeof o.radius === 'number') {
      if (!Number.isFinite(o.radius) || o.radius <= 0) {
        return Err.validation('radius', 'must be a positive finite number');
      }
    } else if (typeof o.radius !== 'string' || o.radius.trim().length === 0) {
      return Err.validation('radius', 'must be a positive number or non-empty expression');
    } else if (NUMERIC_STRING_RE.test(o.radius) && Number(o.radius) <= 0) {
      return Err.validation('radius', 'numeric string must be a positive number');
    }
  },
  // Empty input is explicitly harmless to _allowExpressionEvaluation(), so
  // numeric radii preserve the former conditional gate semantics.
  expressions: (o) => (typeof o.radius === 'string' ? [o.radius] : []),
  validate: (o, layer) => {
    // Numeric performance/quality knobs — all optional, all positive.
    if (o.vertices !== undefined && !isPositiveInt(o.vertices)) {
      return Err.validation('vertices', 'must be a positive integer');
    }
    if (o.arcQuality !== undefined && !isPositiveInt(o.arcQuality)) {
      return Err.validation('arcQuality', 'must be a positive integer');
    }
    if (o.sliceLength !== undefined && !isPositiveInt(o.sliceLength)) {
      return Err.validation('sliceLength', 'must be a positive integer');
    }
    if (o.backtrack !== undefined && !isPositiveInt(o.backtrack)) {
      return Err.validation('backtrack', 'must be a positive integer');
    }
    if (o.tolerance !== undefined && !isPositiveFinite(o.tolerance)) {
      return Err.validation('tolerance', 'must be a positive finite number');
    }
    if (o.type !== undefined && !VALID_TYPES.has(o.type)) {
      return Err.validation('type', `must be one of: left, right, outer, inner`);
    }
    if (o.capStyle !== undefined && !VALID_CAP_STYLES.has(o.capStyle)) {
      return Err.validation('capStyle', 'must be one of: flat, round');
    }

    // `type` (left/right/outer/inner) is documented as polyline-only. Warn
    // (don't reject) when used on polygon — mapshaper still accepts it but
    // the output is rarely what the caller wanted.
    if (o.type !== undefined && layer!.geometry_type === 'polygon') {
      console.warn(
        `bufferLayer: type="${o.type}" is intended for polyline layers; ` +
          `applying to polygon layer "${o.target}" may produce unexpected output.`,
      );
    }
  },
  options: (o) => {
    // Assemble snake_case option bag. Only include keys the caller actually set.
    const bufferOptions: Record<string, unknown> = { radius: String(o.radius) };
    if (o.capStyle !== undefined) bufferOptions.cap_style = o.capStyle;
    if (o.vertices !== undefined) bufferOptions.vertices = o.vertices;
    if (o.arcQuality !== undefined) bufferOptions.arc_quality = o.arcQuality;
    if (o.tolerance !== undefined) bufferOptions.tolerance = o.tolerance;
    if (o.type !== undefined) bufferOptions.type = o.type;
    if (o.planar === true) bufferOptions.planar = true;
    if (o.v2 === true) bufferOptions.v2 = true;
    if (o.sliceLength !== undefined) bufferOptions.slice_length = o.sliceLength;
    if (o.backtrack !== undefined) bufferOptions.backtrack = o.backtrack;
    return bufferOptions;
  },
});
