/** Pure viewport predicates with verifiable semantic keys. Arbitrary caller
 * closures are not cacheable: their captured state can change without identity.
 * Arc geometry/revision and input selections must ALSO participate in any cache.
 */
interface ArcBoundsSource {
  arcIsSmaller?(id: number, minLength: number): boolean;
  arcIntersectsBBox?(id: number, bounds: number[]): boolean;
}
type Predicate = (id: number) => boolean;
const keys = new WeakMap<Predicate, { arcs: ArcBoundsSource; values: readonly number[] }>();

export function arcVisibilityFilter(
  arcs: ArcBoundsSource,
  minLength: number,
  bounds: readonly number[] | null,
): Predicate {
  const bbox = bounds?.slice() ?? null;
  const filter: Predicate = (id) => {
    if (arcs.arcIsSmaller?.(id, minLength)) return false;
    if (bbox && arcs.arcIntersectsBBox && !arcs.arcIntersectsBBox(id, bbox)) return false;
    return true;
  };
  keys.set(filter, { arcs, values: Object.freeze([minLength, ...(bbox ?? [])]) });
  return filter;
}

export function arcVisibilityKey(
  arcs: ArcBoundsSource,
  filter: Predicate | undefined,
): readonly number[] | undefined {
  const entry = filter && keys.get(filter);
  return entry && entry.arcs === arcs ? entry.values : undefined;
}
