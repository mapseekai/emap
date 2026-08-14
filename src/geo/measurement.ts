import { createGeographicCoordinateTransformer } from '../adapter/mapshaper-adapter';
import type { GeographicCoordinateTransformer } from '../adapter/mapshaper-adapter';
import { Geodesic } from 'geographiclib-geodesic';
import { resolveProjectCrsDefinition } from './crs-resolver';

const DEGREES_TO_RADIANS = Math.PI / 180;
const WGS84_SEMI_MAJOR_AXIS = 6_378_137;

export type MeasurementMode = 'length' | 'area';
export type MeasurementPoint = readonly [number, number];

export interface MeasurementContext {
  inverse(point: MeasurementPoint): [number, number] | null;
  forward(lngLat: MeasurementPoint): [number, number] | null;
  length(points: readonly MeasurementPoint[]): number | null;
  area(points: readonly MeasurementPoint[]): number | null;
}

export class MeasurementCalculator {
  private readonly _contexts = new Map<string, Promise<MeasurementContext | null>>();

  async getContext(crs: string): Promise<MeasurementContext | null> {
    try {
      const { definition, signature } = await resolveProjectCrsDefinition(crs);
      let context = this._contexts.get(signature);
      if (!context) {
        context = Promise.resolve().then(() => this._createContext(definition));
        this._contexts.set(signature, context);
      }
      return await context;
    } catch {
      return null;
    }
  }

  private _createContext(definition: string): MeasurementContext | null {
    const transformer = createGeographicCoordinateTransformer(definition);
    if (!transformer.isEarthCompatible) return null;

    const geodesic = new Geodesic.Geodesic(transformer.semiMajorAxis, transformer.flattening);
    return {
      inverse(point): [number, number] | null {
        return transformer.inverse(point);
      },
      forward(lngLat): [number, number] | null {
        return transformer.forward(lngLat);
      },
      length(points): number | null {
        const lngLat = toGeographicPoints(points, transformer);
        return lngLat ? calculateGeodesicLength(lngLat, geodesic) : null;
      },
      area(points): number | null {
        const lngLat = toGeographicPoints(points, transformer);
        return lngLat ? calculateSphericalArea(lngLat) : null;
      },
    };
  }
}

export function calculateSphericalArea(points: readonly MeasurementPoint[]): number | null {
  const ring = normalizeRing(points);
  if (!ring) return null;

  let sum = 0;
  let previousLongitude = ring[0][0];
  let previousLatitude = ring[0][1] * DEGREES_TO_RADIANS;
  for (let index = 1; index <= ring.length; index++) {
    const point = ring[index % ring.length];
    let longitude = point[0];
    while (longitude - previousLongitude > 180) longitude -= 360;
    while (longitude - previousLongitude < -180) longitude += 360;

    const latitude = point[1] * DEGREES_TO_RADIANS;
    sum += (longitude - previousLongitude) * DEGREES_TO_RADIANS *
      (2 + Math.sin(previousLatitude) + Math.sin(latitude));
    previousLongitude = longitude;
    previousLatitude = latitude;
  }

  const area = Math.abs((sum * WGS84_SEMI_MAJOR_AXIS * WGS84_SEMI_MAJOR_AXIS) / 2);
  return Number.isFinite(area) ? area : null;
}

export function formatMeasurement(mode: MeasurementMode, value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;

  if (mode === 'length') {
    return value < 1_000
      ? `${formatNumber(value)} m`
      : `${formatNumber(value / 1_000)} km`;
  }
  return value < 1_000_000
    ? `${formatNumber(value)} m²`
    : `${formatNumber(value / 1_000_000)} km²`;
}

function toGeographicPoints(
  points: readonly MeasurementPoint[],
  transformer: GeographicCoordinateTransformer,
): MeasurementPoint[] | null {
  const lngLat: MeasurementPoint[] = [];
  for (const point of points) {
    const coordinate = transformer.inverse(point);
    if (!coordinate || !isGeographicPoint(coordinate)) return null;
    lngLat.push(coordinate);
  }
  return lngLat;
}

function calculateGeodesicLength(
  points: readonly MeasurementPoint[],
  geodesic: InstanceType<typeof Geodesic.Geodesic>,
): number | null {
  if (points.length < 2) return null;

  let total = 0;
  let previous = points[0];
  if (!isGeographicPoint(previous)) return null;
  for (let index = 1; index < points.length; index++) {
    const point = points[index];
    if (!isGeographicPoint(point)) return null;
    if (point[0] === previous[0] && point[1] === previous[1]) continue;

    const segment = geodesic.Inverse(previous[1], previous[0], point[1], point[0]).s12;
    if (segment === undefined || !Number.isFinite(segment)) return null;
    total += Math.abs(segment);
    previous = point;
  }
  return Number.isFinite(total) ? total : null;
}

function normalizeRing(points: readonly MeasurementPoint[]): MeasurementPoint[] | null {
  const ring: MeasurementPoint[] = [];
  for (const point of points) {
    if (!isGeographicPoint(point)) return null;
    const previous = ring.at(-1);
    if (!previous || point[0] !== previous[0] || point[1] !== previous[1]) {
      ring.push([point[0], point[1]]);
    }
  }

  const first = ring[0];
  const last = ring.at(-1);
  if (ring.length > 1 && first[0] === last![0] && first[1] === last![1]) ring.pop();
  return ring.length >= 3 ? ring : null;
}

function isGeographicPoint(point: MeasurementPoint): boolean {
  return (
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]) &&
    point[1] >= -90 &&
    point[1] <= 90
  );
}

function formatNumber(value: number): string {
  return Number(value.toPrecision(3)).toString();
}
