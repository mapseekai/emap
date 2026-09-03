import { Geodesic } from 'geographiclib-geodesic';

export type GeodesicInstance = InstanceType<typeof Geodesic.Geodesic>;

/**
 * Shortest-path distance in meters between two `[lng, lat]` points on the
 * given ellipsoid. Returns `null` when the inverse solution is unavailable
 * or non-finite.
 */
export function geodesicDistanceMeters(
  geodesic: GeodesicInstance,
  first: readonly [number, number],
  second: readonly [number, number],
): number | null {
  const distance = geodesic.Inverse(first[1], first[0], second[1], second[0]).s12;
  return distance !== undefined && Number.isFinite(distance) ? Math.abs(distance) : null;
}
