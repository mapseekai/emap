interface FeatureIdentity {
  source: string;
  layer: string;
  id: number;
}

/**
 * Minimal read-only visibility lookup accepted by low-level rendering queries.
 * Implementations expose membership only; their map/set storage stays private.
 */
export interface VisibleLayerLookup {
  get(sourceId: string): { has(layerId: string): boolean } | undefined;
}

export type LayerKeyIndex = ReadonlyMap<string, ReadonlySet<string>>;
export type MutableLayerKeyIndex = Map<string, Set<string>>;

export function addLayerKey(index: MutableLayerKeyIndex, source: string, layer: string): void {
  const layers = index.get(source) ?? new Set<string>();
  layers.add(layer);
  index.set(source, layers);
}

export function hasLayerKey(index: VisibleLayerLookup, source: string, layer: string): boolean {
  return index.get(source)?.has(layer) === true;
}

export type LayerValueIndex<T> = ReadonlyMap<string, ReadonlyMap<string, T>>;
export type MutableLayerValueIndex<T> = Map<string, Map<string, T>>;

export function setLayerValue<T>(
  index: MutableLayerValueIndex<T>,
  source: string,
  layer: string,
  value: T,
): void {
  const layers = index.get(source) ?? new Map<string, T>();
  layers.set(layer, value);
  index.set(source, layers);
}

export function getLayerValue<T>(
  index: LayerValueIndex<T>,
  source: string,
  layer: string,
): T | undefined {
  return index.get(source)?.get(layer);
}

export type FeatureIdentityIndex = Map<string, Map<string, Set<number>>>;

export function addFeatureIdentity(index: FeatureIdentityIndex, feature: FeatureIdentity): boolean {
  const layers = index.get(feature.source) ?? new Map<string, Set<number>>();
  const ids = layers.get(feature.layer) ?? new Set<number>();
  if (ids.has(feature.id)) return false;
  ids.add(feature.id);
  layers.set(feature.layer, ids);
  index.set(feature.source, layers);
  return true;
}

export function sameFeatureIdentity(a: FeatureIdentity | null, b: FeatureIdentity | null): boolean {
  return (
    a === b ||
    (a !== null && b !== null && a.source === b.source && a.layer === b.layer && a.id === b.id)
  );
}
