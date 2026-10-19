import { cloneIconOptions, type IconOptions } from './icon';
import { cloneLabelOptions, type LabelOptions } from './label';
import type { StyleExpression } from './style-expression';

/** MapLibre-inspired layout properties supported by the existing emap renderers.
 * @example
 * const layout: SymbolLayout = { 'text-field': ['get', 'name'], 'text-size': 14, 'text-offset': [0, 1.2] };
 */
export interface SymbolLayout {
  /** Hides the attached text/icon only, not the parent geometry. */
  visibility?: 'visible' | 'none';
  /** Literal text or the existing safe expression subset; no token-template expansion. */
  'text-field'?: string | StyleExpression;
  'text-size'?: number;
  /** One font family/face. MSDF keeps its own Noto/custom-font resolver. */
  'text-font'?: readonly string[];
  /** em units, converted to the existing screen-pixel placement offset. */
  'text-offset'?: readonly [number, number];
  'text-allow-overlap'?: boolean;
  'text-padding'?: number;
  /** Name in symbol.images. Images retain the existing URL/rect cache. */
  'icon-image'?: string;
  /** Multiplier of symbol.images[name].size; never a CSS-pixel height. */
  'icon-size'?: number;
  'icon-anchor'?:
    | 'center'
    | 'left'
    | 'right'
    | 'top'
    | 'bottom'
    | 'top-left'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-right';
  'icon-rotate'?: number;
  /** Multiplied by icon-size, then rotated with the icon, before conversion to screen pixels. */
  'icon-offset'?: readonly [number, number];
}
/** MapLibre-inspired paint properties, mapped to existing native label/icon paint.
 * @example
 * const paint: SymbolPaint = { 'text-color': '#243447', 'text-halo-color': '#fff', 'text-halo-width': 1.5, 'icon-opacity': 1 };
 */
export interface SymbolPaint {
  'text-color'?: string;
  'text-halo-color'?: string;
  'text-halo-width'?: number;
  'icon-opacity'?: number;
  /** Existing alpha-mask tint; does not require a MapLibre SDF sprite. */
  'icon-color'?: string;
}
/** Image resource metadata, not a new image or map layer. No network access during mapping.
 * @example
 * const image: SymbolImage = { url: '/icons/marker@2x.png', size: [24, 32] };
 */
export interface SymbolImage {
  url: string;
  /** Reference CSS-pixel height (preserving aspect) or [width,height], independent of source image resolution. */
  size: number | readonly [number, number];
  /** Optional original-image pixel crop, as in IconOptions.rect. */
  rect?: readonly [number, number, number, number];
}
/** Advanced GIS labeling controls inspired by QGIS labeling settings.
 * These remain attached to the parent layer and map to the existing emap label engine.
 * @example
 * const labeling: SymbolLabeling = { placement: 'parallel', priority: ['get', 'rank'], maxLabels: 500 };
 */
export interface SymbolLabeling {
  enabled?: boolean;
  fontUrl?: string;
  fontWeight?: LabelOptions['fontWeight'];
  fontStyle?: LabelOptions['fontStyle'];
  placement?: LabelOptions['placement'];
  priority?: LabelOptions['priority'];
  maxLabels?: number;
  minScale?: number;
  maxScale?: number;
}

/** Icon-only native controls not represented by the MapLibre-inspired layout subset.
 * @example
 * const icon: SymbolIconSettings = { enabled: true, anchor: [0.5, 1] };
 */
export interface SymbolIconSettings {
  enabled?: boolean;
  /** Native fractional anchors not expressible by the nine named icon-anchor values. */
  anchor?: readonly [number, number];
}
/** Attached to an existing circle/line/fill layer. Not a MapLibre style document or symbol layer.
 * @example
 * map.addLayer({ id: 'poi', source: 'poi', type: 'circle', symbol: {
 *   images: { marker: { url: '/marker.png', size: [24, 32] } },
 *   layout: { 'icon-image': 'marker', 'icon-size': 1, 'icon-anchor': 'bottom', 'text-field': ['get', 'name'], 'text-size': 14 },
 *   paint: { 'text-color': '#243447', 'text-halo-color': '#fff', 'text-halo-width': 1.5 }
 * } });
 */
export interface SymbolStyle {
  layout?: SymbolLayout;
  paint?: SymbolPaint;
  /** Local named image definitions; the same URL is shared by the existing renderer cache. */
  images?: Readonly<Record<string, SymbolImage>>;
  /** Advanced text labeling controls that do not fit the MapLibre-inspired layout/paint subset. */
  labeling?: SymbolLabeling;
  /** Icon-only compatibility controls for native anchors/enabled state. */
  icon?: SymbolIconSettings;
}
export const ICON_ANCHORS: Readonly<
  Record<NonNullable<SymbolLayout['icon-anchor']>, readonly [number, number]>
> = {
  center: [0.5, 0.5],
  left: [0, 0.5],
  right: [1, 0.5],
  top: [0.5, 0],
  bottom: [0.5, 1],
  'top-left': [0, 0],
  'top-right': [1, 0],
  'bottom-left': [0, 1],
  'bottom-right': [1, 1],
};
const layoutKeys = new Set([
  'visibility',
  'text-field',
  'text-size',
  'text-font',
  'text-offset',
  'text-allow-overlap',
  'text-padding',
  'icon-image',
  'icon-size',
  'icon-anchor',
  'icon-rotate',
  'icon-offset',
]);
const paintKeys = new Set([
  'text-color',
  'text-halo-color',
  'text-halo-width',
  'icon-opacity',
  'icon-color',
]);
const labelingKeys = new Set([
  'enabled',
  'fontUrl',
  'fontWeight',
  'fontStyle',
  'placement',
  'priority',
  'maxLabels',
  'minScale',
  'maxScale',
]);
const iconSettingsKeys = new Set(['enabled', 'anchor']);
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
function record(value: unknown, path: string): void {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)
  )
    throw new Error(`${path} must be a plain object.`);
}
function keys(value: object, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (forbidden.has(key)) throw new Error(`Unsafe symbol key: ${key}`);
    if (!allowed.has(key)) {
      const destination =
        path.endsWith('layout') && paintKeys.has(key)
          ? ' Use symbol.paint.'
          : path.endsWith('paint') && layoutKeys.has(key)
            ? ' Use symbol.layout.'
            : '';
      throw new Error(`Unsupported ${path} property: ${key}.${destination}`);
    }
  }
}
function pair(value: unknown, path: string): asserts value is readonly [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n))
  )
    throw new Error(`${path} requires two finite numbers.`);
}
function font(layout: SymbolLayout, labeling: SymbolLabeling): Partial<LabelOptions> {
  const stack = layout['text-font'];
  if (stack === undefined) return {};
  if (
    !Array.isArray(stack) ||
    stack.length !== 1 ||
    typeof stack[0] !== 'string' ||
    !stack[0].trim() ||
    stack[0].length > 256
  )
    throw new Error('symbol.layout.text-font currently requires exactly one font family/face.');
  const name = stack[0].trim();
  const builtin = /^(Noto Sans SC|Noto Serif SC|Noto Sans Mono)(?: (Regular|Bold))?$/i.exec(name);
  if (builtin)
    return {
      fontFamily: builtin[1],
      ...(labeling.fontWeight === undefined && builtin[2]
        ? { fontWeight: builtin[2].toLowerCase() === 'bold' ? 'bold' : 'normal' }
        : {}),
    };
  return { fontFamily: name };
}
/** Checks every supplied value, even if its associated text/icon is disabled. */
function validate(style: SymbolStyle): void {
  record(style, 'symbol');
  keys(style, new Set(['layout', 'paint', 'images', 'labeling', 'icon']), 'symbol');
  const layout = style.layout ?? {},
    paint = style.paint ?? {},
    labeling = style.labeling ?? {},
    iconSettings = style.icon ?? {};
  if (style.layout !== undefined) record(style.layout, 'symbol.layout');
  if (style.paint !== undefined) record(style.paint, 'symbol.paint');
  if (style.labeling !== undefined) record(style.labeling, 'symbol.labeling');
  if (style.icon !== undefined) record(style.icon, 'symbol.icon');
  keys(layout, layoutKeys, 'symbol.layout');
  keys(paint, paintKeys, 'symbol.paint');
  keys(labeling, labelingKeys, 'symbol.labeling');
  keys(iconSettings, iconSettingsKeys, 'symbol.icon');
  if (
    layout['text-field'] !== undefined &&
    typeof layout['text-field'] !== 'string' &&
    !Array.isArray(layout['text-field'])
  )
    throw new Error('text-field requires literal text or a supported expression.');
  if (
    layout['text-size'] !== undefined &&
    (typeof layout['text-size'] !== 'number' || !Number.isFinite(layout['text-size']))
  )
    throw new Error('text-size requires a finite CSS-pixel number.');
  if (layout.visibility !== undefined && !['visible', 'none'].includes(layout.visibility))
    throw new Error('Invalid symbol.layout.visibility.');
  if (labeling.enabled !== undefined && typeof labeling.enabled !== 'boolean')
    throw new Error('Invalid symbol.labeling.enabled.');
  if (iconSettings.enabled !== undefined && typeof iconSettings.enabled !== 'boolean')
    throw new Error('Invalid symbol.icon.enabled.');
  if (
    layout['icon-image'] !== undefined &&
    (typeof layout['icon-image'] !== 'string' ||
      layout['icon-image']!.length > 256 ||
      forbidden.has(layout['icon-image']!))
  )
    throw new Error('icon-image must be a literal image name, not an expression or URL.');
  if (
    layout['icon-size'] !== undefined &&
    (typeof layout['icon-size'] !== 'number' ||
      !Number.isFinite(layout['icon-size']) ||
      layout['icon-size']! < 0)
  )
    throw new Error('icon-size must be a finite nonnegative scale factor.');
  if (
    layout['icon-anchor'] !== undefined &&
    (typeof layout['icon-anchor'] !== 'string' ||
      !Object.hasOwn(ICON_ANCHORS, layout['icon-anchor']!))
  )
    throw new Error('Unsupported icon-anchor.');
  if (layout['icon-offset'] !== undefined) pair(layout['icon-offset'], 'icon-offset');
  if (layout['text-offset'] !== undefined) pair(layout['text-offset'], 'text-offset');
  if (style.images !== undefined) {
    record(style.images, 'symbol.images');
    if (Object.keys(style.images).length > 32)
      throw new Error('symbol.images supports at most 32 image definitions.');
    let urlBytes = 0;
    for (const [id, image] of Object.entries(style.images)) {
      if (!id.trim() || id.length > 256 || forbidden.has(id))
        throw new Error('Invalid symbol image name.');
      record(image, `symbol.images.${id}`);
      keys(image, new Set(['url', 'size', 'rect']), `symbol.images.${id}`);
      if (image.size === undefined)
        throw new Error(`symbol.images.${id}.size requires a reference CSS-pixel size.`);
      cloneIconOptions(image);
      urlBytes += image.url.length;
    }
    if (urlBytes > 8 * 1024 ** 2)
      throw new Error('Symbol image URL data exceeds the style budget.');
  }
  // Reuse the native validators and their expression complexity/range checks.
  nativeLabel(style);
  cloneIconOptions({
    url: '/validation-only.png',
    rotation: layout['icon-rotate'],
    offset: layout['icon-offset'],
    anchor: iconSettings.anchor,
    opacity: paint['icon-opacity'],
    tint: paint['icon-color'],
  });
}
function nativeLabel(style: SymbolStyle): LabelOptions {
  const l = style.layout ?? {},
    p = style.paint ?? {},
    labeling = style.labeling ?? {},
    size = l['text-size'] ?? 14;
  const field = l['text-field'];
  const source =
    Array.isArray(field) && field.length === 2 && field[0] === 'get' && typeof field[1] === 'string'
      ? { field: field[1] }
      : { text: field ?? '' };
  return cloneLabelOptions({
    ...source,
    ...font(l, labeling),
    fontSize: size,
    ...(labeling.fontWeight !== undefined ? { fontWeight: labeling.fontWeight } : {}),
    fontStyle: labeling.fontStyle,
    fontUrl: labeling.fontUrl,
    color: p['text-color'],
    haloColor: p['text-halo-color'],
    haloWidth: p['text-halo-width'],
    ...(l['text-offset'] !== undefined
      ? { offset: l['text-offset'].map((n) => n * size) as [number, number] }
      : {}),
    allowOverlap: l['text-allow-overlap'],
    padding: l['text-padding'],
    placement: labeling.placement,
    priority: labeling.priority,
    maxLabels: labeling.maxLabels,
    minScale: labeling.minScale,
    maxScale: labeling.maxScale,
    enabled: l.visibility !== 'none' && labeling.enabled !== false,
  });
}
/** Pure setting-time mapping. No source geometry, worker, image decode or GPU is touched. */
export function compileSymbolStyle(
  style: SymbolStyle,
  parentType: 'circle' | 'line' | 'fill',
): { label?: LabelOptions; icon?: IconOptions } {
  validate(style);
  const l = style.layout ?? {},
    p = style.paint ?? {},
    iconSettings = style.icon ?? {};
  const result: { label?: LabelOptions; icon?: IconOptions } = {};
  if (l['text-field'] !== undefined && l['text-field'] !== '') result.label = nativeLabel(style);
  const id = l['icon-image'];
  if (id) {
    if (parentType !== 'circle')
      throw new Error('Symbol icons require an existing circle/point layer.');
    if (!style.images || !Object.hasOwn(style.images, id))
      throw new Error(`Unknown symbol image "${id}". Define it in symbol.images.`);
    const image = style.images[id],
      factor = l['icon-size'] ?? 1,
      sizeFactor = factor || 1;
    const size =
      typeof image.size === 'number'
        ? image.size * sizeFactor
        : (image.size.map((n) => n * sizeFactor) as [number, number]);
    const rotation = l['icon-rotate'] ?? 0,
      angle = ((rotation % 360) * Math.PI) / 180;
    const [x, y] = l['icon-offset'] ?? [0, 0];
    result.icon = cloneIconOptions({
      url: image.url,
      rect: image.rect,
      size,
      anchor:
        l['icon-anchor'] !== undefined
          ? ICON_ANCHORS[l['icon-anchor']]
          : (iconSettings.anchor ?? ICON_ANCHORS.center),
      rotation,
      offset: [
        (Math.cos(angle) * x - Math.sin(angle) * y) * factor,
        (Math.sin(angle) * x + Math.cos(angle) * y) * factor,
      ],
      opacity: p['icon-opacity'],
      tint: p['icon-color'],
      enabled: factor > 0 && l.visibility !== 'none' && iconSettings.enabled !== false,
    });
  }
  return result;
}
/** Serializable deep clone; rejects cyclic, executable and prototype-bearing settings. */
export function cloneSymbolStyle(style: SymbolStyle): SymbolStyle {
  let nodes = 0;
  const copy = (value: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 24)
      throw new Error('Symbol settings exceed the complexity limit (or contain a cycle).');
    if (
      value === undefined ||
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Symbol numbers must be finite.');
      return value;
    }
    if (Array.isArray(value)) return value.map((v) => copy(v, depth + 1));
    record(value, 'Symbol settings');
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.has(key)) throw new Error(`Unsafe symbol key: ${key}`);
      if (child !== undefined) result[key] = copy(child, depth + 1);
    }
    return result;
  };
  const result = copy(style, 0) as SymbolStyle;
  validate(result);
  return result;
}
/** null/undefined removes one property (restores its default), not the entire symbol. */
export function updateSymbolProperty(
  style: SymbolStyle,
  section: 'layout' | 'paint',
  name: string,
  value: unknown,
): SymbolStyle {
  const allowed = section === 'layout' ? layoutKeys : paintKeys;
  keys({ [name]: value }, allowed, `symbol.${section}`);
  const next = cloneSymbolStyle(style),
    properties: Record<string, unknown> = { ...next[section] };
  if (value === null || value === undefined) delete properties[name];
  else properties[name] = value;
  return cloneSymbolStyle({ ...next, [section]: properties });
}
