import { compileStyleExpression, type StyleExpression } from './style-expression';

/** Labels belong to their vector layer, never to an additional text layer/source. */
export interface LabelOptions {
  enabled?: boolean;
  /** Attribute column. Mutually exclusive with text. Null/missing values are not labelled. */
  field?: string;
  /** Literal text or the existing safe style-expression subset (no JavaScript evaluation). */
  text?: string | StyleExpression;
  fontFamily?: string;
  /** Font outline URL for MSDF (TTF/OTF/WOFF1); resolved by the host, fetched locally in its Worker. */
  fontUrl?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold' | number;
  fontStyle?: 'normal' | 'italic';
  color?: string;
  haloColor?: string;
  haloWidth?: number;
  /** CSS pixel offset applied after placement. */
  offset?: readonly [number, number];
  /** Auto: around points, parallel to lines, interior of polygons. */
  placement?: 'auto' | 'horizontal' | 'parallel';
  allowOverlap?: boolean;
  /** Higher priorities are placed first; ties use parent layer order and feature ID. */
  priority?: number | StyleExpression;
  /** CRS-agnostic |mx| limits, in CSS pixels per source coordinate unit. */
  minScale?: number;
  maxScale?: number;
  maxLabels?: number;
  /** Collision spacing in CSS pixels, including the text halo. */
  padding?: number;
}

const allowed = new Set([
  'enabled',
  'field',
  'text',
  'fontFamily',
  'fontUrl',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'color',
  'haloColor',
  'haloWidth',
  'offset',
  'placement',
  'allowOverlap',
  'priority',
  'minScale',
  'maxScale',
  'maxLabels',
  'padding',
]);

function expression(value: unknown): asserts value is StyleExpression {
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 1024 || depth > 16)
      throw new Error('Label expression exceeds its complexity limit.');
    if (Array.isArray(v)) {
      for (const n of v) visit(n, depth + 1);
    } else if (v !== null && !['string', 'number', 'boolean'].includes(typeof v))
      throw new Error('Label expressions must contain serializable values.');
  };
  visit(value, 0);
  if (!Array.isArray(value)) throw new Error('Invalid label expression.');
  compileStyleExpression(value);
}

export function validateLabelOptions(options: LabelOptions): void {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new Error('label must be an options object.');
  for (const key of Object.keys(options))
    if (!allowed.has(key)) throw new Error(`Unknown label option: ${key}`);
  for (const key of ['enabled', 'allowOverlap'] as const)
    if (options[key] !== undefined && typeof options[key] !== 'boolean')
      throw new Error(`label.${key} must be boolean.`);
  if (
    options.field !== undefined &&
    (typeof options.field !== 'string' || !options.field || options.field.length > 256)
  )
    throw new Error('label.field must be a nonempty column name.');
  if (options.field !== undefined && options.text !== undefined)
    throw new Error('Choose label.field or label.text, not both.');
  if (options.enabled !== false && options.field === undefined && options.text === undefined)
    throw new Error('Enabled labels require field or text.');
  if (options.text !== undefined) {
    if (typeof options.text === 'string') {
      if (options.text.length > 2048) throw new Error('Label text is too long.');
    } else expression(options.text);
  }
  for (const key of ['fontFamily', 'color', 'haloColor'] as const)
    if (
      options[key] !== undefined &&
      (typeof options[key] !== 'string' || !options[key]!.trim() || options[key]!.length > 256)
    )
      throw new Error(`Invalid label.${key}.`);
  if (
    options.fontUrl !== undefined &&
    (typeof options.fontUrl !== 'string' ||
      !options.fontUrl.trim() ||
      options.fontUrl.length > 4096)
  )
    throw new Error('Invalid label.fontUrl.');
  const ranges = {
    fontSize: [6, 96],
    haloWidth: [0, 12],
    padding: [0, 64],
    maxLabels: [1, 10000],
    minScale: [0, Number.MAX_VALUE],
    maxScale: [0, Number.MAX_VALUE],
  } as const;
  for (const key of Object.keys(ranges) as (keyof typeof ranges)[]) {
    const n = options[key],
      [lo, hi] = ranges[key];
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < lo || n > hi))
      throw new Error(`Invalid label.${key}.`);
  }
  if (options.maxLabels !== undefined && !Number.isInteger(options.maxLabels))
    throw new Error('label.maxLabels must be an integer.');
  if ((options.minScale ?? 0) > (options.maxScale ?? Infinity))
    throw new Error('Invalid label scale range.');
  if (
    options.fontWeight !== undefined &&
    options.fontWeight !== 'normal' &&
    options.fontWeight !== 'bold' &&
    !(
      typeof options.fontWeight === 'number' &&
      Number.isInteger(options.fontWeight) &&
      options.fontWeight >= 100 &&
      options.fontWeight <= 900
    )
  )
    throw new Error('Invalid label.fontWeight.');
  if (options.fontStyle !== undefined && !['normal', 'italic'].includes(options.fontStyle))
    throw new Error('Invalid label.fontStyle.');
  if (
    options.placement !== undefined &&
    !['auto', 'horizontal', 'parallel'].includes(options.placement)
  )
    throw new Error('Invalid label.placement.');
  if (
    options.offset !== undefined &&
    (!Array.isArray(options.offset) ||
      options.offset.length !== 2 ||
      options.offset.some((n) => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 512))
  )
    throw new Error('label.offset requires two finite CSS pixel offsets within ±512.');
  if (options.priority !== undefined) {
    if (typeof options.priority === 'number') {
      if (!Number.isFinite(options.priority)) throw new Error('Invalid label.priority.');
    } else expression(options.priority);
  }
}

/** Deep-copy all nested expression arrays; callers cannot change stored layer settings. */
export function cloneLabelOptions(options: LabelOptions): LabelOptions {
  validateLabelOptions(options);
  return JSON.parse(JSON.stringify(options)) as LabelOptions;
}

export function labelText(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean')
    return '';
  if (typeof value === 'number' && !Number.isFinite(value)) return '';
  const text = String(value)
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\t/g, ' ')
    .trim();
  // Whole Unicode code points, never half of a surrogate pair. Oversized labels are skipped.
  return text.length <= 1024 && Array.from(text).length <= 256 ? text : '';
}
