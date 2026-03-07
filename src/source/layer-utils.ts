import type { MapshaperLayer } from '../types/mapshaper-types';

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
 * Normalize a Mapshaper point shape to a consistent `number[][]` format.
 * Handles both `[x, y]` (single point) and `[[x, y], ...]` (multi-point).
 */
export function normalizePointShape(shape: unknown): number[][] {
  if (!shape) return [];
  if (!Array.isArray(shape)) return [];
  if (typeof shape[0] === 'number') {
    return [shape as number[]];
  }
  if (Array.isArray(shape[0])) {
    return shape as number[][];
  }
  return [];
}
