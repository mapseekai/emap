import type { Coord2, MapshaperLayer } from '../types/mapshaper-types';

/**
 * Derive a stable layer identifier from a Mapshaper layer object.
 * Falls back to a positional `layer-N` string.
 */
export function getLayerId(layer: MapshaperLayer, index: number): string {
  if (layer?.name) return String(layer.name);
  if (layer?.id) return String(layer.id);
  return `layer-${index}`;
}

/**
 * Coerce a mapshaper point shape to a uniform `Coord2[]` (multi-point) form.
 * Tolerates the legacy bare `[x, y]` single-point shape that some older
 * datasets carry by wrapping it in a one-element array.
 */
export function normalizePointShape(shape: unknown): Coord2[] {
  if (!shape) return [];
  if (!Array.isArray(shape)) return [];
  if (typeof shape[0] === 'number') {
    return [shape as Coord2];
  }
  if (Array.isArray(shape[0])) {
    return shape as Coord2[];
  }
  return [];
}
