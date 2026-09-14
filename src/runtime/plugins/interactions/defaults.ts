import type { HandlerRegistration } from '../../../engine/core/handler-manager';

/** Defaults belong to the shipped GIS features, not the generic input router. */
const names = [
  'lassoSelect',
  'boxSelect',
  'clickSelect',
  'transformFeature',
  'splitFeature',
  'reshapeFeature',
  'autoCompletePolygon',
  'ringEdit',
  'partEdit',
  'drawFeature',
  'measure',
  'vertexEdit',
  'dragPan',
  'scrollZoom',
] as const;

export function builtinInteractionOptions(name: string): HandlerRegistration {
  const index = (names as readonly string[]).indexOf(name);
  return {
    priority: index < 0 ? 0 : (names.length - index) * 10,
    ...(name === 'dragPan' || name === 'scrollZoom' ? { group: 'navigation' } : {}),
  };
}
