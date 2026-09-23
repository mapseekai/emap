import { cloneIconOptions, type IconOptions } from './icon';
import { cloneLabelOptions, type LabelOptions } from './label';
import { cloneSymbolStyle, ICON_ANCHORS, type SymbolStyle, type SymbolLayout } from './symbol';

function clearChannel(style: SymbolStyle, channel: 'text' | 'icon'): SymbolStyle {
  const next = cloneSymbolStyle(style);
  next.layout = Object.fromEntries(
    Object.entries(next.layout ?? {}).filter(([key]) => !key.startsWith(`${channel}-`)),
  );
  next.paint = Object.fromEntries(
    Object.entries(next.paint ?? {}).filter(([key]) => !key.startsWith(`${channel}-`)),
  );
  if (channel === 'text') next.labeling = {};
  else next.icon = {};
  return next;
}
/** Compatibility writes update the canonical symbol text channel, retaining the icon channel. */
export function withSymbolLabel(style: SymbolStyle, input: LabelOptions | null): SymbolStyle {
  const next = clearChannel(style, 'text');
  if (input === null) return next;
  const label = cloneLabelOptions(input),
    size = label.fontSize ?? 14;
  Object.assign(next.layout!, {
    'text-field': label.field !== undefined ? ['get', label.field] : label.text,
    'text-size': label.fontSize,
    'text-font': label.fontFamily ? [label.fontFamily] : undefined,
    'text-offset': label.offset?.map((n) => n / size),
    'text-allow-overlap': label.allowOverlap,
    'text-padding': label.padding,
  });
  Object.assign(next.paint!, {
    'text-color': label.color,
    'text-halo-color': label.haloColor,
    'text-halo-width': label.haloWidth,
  });
  Object.assign(next.labeling!, {
    enabled: label.enabled,
    fontUrl: label.fontUrl,
    fontWeight: label.fontWeight,
    fontStyle: label.fontStyle,
    placement: label.placement,
    priority: label.priority,
    maxLabels: label.maxLabels,
    minScale: label.minScale,
    maxScale: label.maxScale,
  });
  return cloneSymbolStyle(next);
}
/** Convert absolute native icon settings to factor/anchor/rotated-offset settings without decoding images. */
export function withSymbolIcon(style: SymbolStyle, input: IconOptions | null): SymbolStyle {
  const id = style.layout?.['icon-image'] || 'icon',
    next = clearChannel(style, 'icon');
  if (input === null) return next;
  const icon = cloneIconOptions(input),
    anchor = icon.anchor ?? [0.5, 0.5];
  const name = Object.entries(ICON_ANCHORS).find(
    ([, p]) => p[0] === anchor[0] && p[1] === anchor[1],
  )?.[0] as SymbolLayout['icon-anchor'];
  const angle = (((icon.rotation ?? 0) % 360) * Math.PI) / 180,
    [x, y] = icon.offset ?? [0, 0];
  next.images = {
    ...next.images,
    [id]: { url: icon.url, size: icon.size ?? 32, ...(icon.rect ? { rect: icon.rect } : {}) },
  };
  Object.assign(next.layout!, {
    'icon-image': id,
    'icon-size': 1,
    'icon-anchor': name,
    'icon-rotate': icon.rotation,
    'icon-offset': [
      Math.cos(angle) * x + Math.sin(angle) * y,
      -Math.sin(angle) * x + Math.cos(angle) * y,
    ],
  });
  Object.assign(next.paint!, { 'icon-opacity': icon.opacity, 'icon-color': icon.tint });
  Object.assign(next.icon!, {
    enabled: icon.enabled,
    ...(!name ? { anchor } : {}),
  });
  return cloneSymbolStyle(next);
}
/** Used only when explicitly migrating legacy settings or entering the new settings panel. */
export function symbolStyleFromLegacy(label?: LabelOptions, icon?: IconOptions): SymbolStyle {
  return withSymbolIcon(withSymbolLabel({}, label ?? null), icon ?? null);
}
