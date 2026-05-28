import type { PointStyle, StrokeStyle } from '../../types/mapshaper-types';

export type Rgba = [number, number, number, number];

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseColor(input: string | undefined, opacity = 1): Rgba {
  const color = (input || '#333').trim().toLowerCase();
  const normalized = NAMED_COLORS[color] || color;
  const alphaScale = clamp01(opacity);

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const full = hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex;
    const int = Number.parseInt(full.slice(0, 6), 16);
    if (Number.isFinite(int)) {
      return [
        ((int >> 16) & 255) / 255,
        ((int >> 8) & 255) / 255,
        (int & 255) / 255,
        alphaScale,
      ];
    }
  }

  const rgba = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map(part => Number(part.trim()));
    return [
      clamp01(parts[0] / 255),
      clamp01(parts[1] / 255),
      clamp01(parts[2] / 255),
      clamp01((Number.isFinite(parts[3]) ? parts[3] : 1) * alphaScale),
    ];
  }

  return parseColor('#333', opacity);
}

export function resolveStrokeUniforms(style: StrokeStyle, pixelRatio: number) {
  return {
    color: parseColor(style.color),
    width: (style.width ?? 1) * pixelRatio,
  };
}

export function resolvePointUniforms(style: PointStyle, pixelRatio: number) {
  return {
    color: parseColor(style.color),
    radius: (Number(style.radius) || 4) * pixelRatio,
    fill: style.fill !== false,
  };
}
