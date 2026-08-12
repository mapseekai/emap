import { createGeographicCoordinateTransformer } from '../adapter/mapshaper-adapter';
import type { GeographicCoordinateTransformer } from '../adapter/mapshaper-adapter';
import { Geodesic } from 'geographiclib-geodesic';
import { resolveProjectCrsDefinition } from './crs-resolver';

export type ScaleCalculationMethod = 'top' | 'center' | 'bottom' | 'average' | 'equator';

export interface ScaleMetrics {
  metersPerPixel: number;
  scaleDenominator: number;
  calculationMethod: ScaleCalculationMethod;
}

export interface GetScaleMetricsOptions {
  calculationMethod?: ScaleCalculationMethod;
  dpi?: number;
}

export interface ScaleView {
  crs: string;
  width: number;
  height: number;
  unproject(px: number, py: number): [number, number];
}

export type ScaleDistanceUnit = 'metric' | 'imperial' | 'dual' | 'm' | 'km' | 'ft' | 'mi';

export interface ScaleDistance {
  distance: number;
  width: number;
  metricLabel: string;
  imperialLabel: string;
  dualLabel: string;
}

const METERS_PER_FOOT = 0.3048;
const METERS_PER_MILE = 1609.344;

function formatNumber(value: number): string {
  return Number(value.toPrecision(3)).toString();
}

export function formatScaleDistance(distance: number, unit: ScaleDistanceUnit): string | null {
  if (!Number.isFinite(distance) || distance < 0) return null;

  if (unit === 'm') return `${formatNumber(distance)} m`;
  if (unit === 'km') return `${formatNumber(distance)} km`;
  if (unit === 'ft') return `${formatNumber(distance)} ft`;
  if (unit === 'mi') return `${formatNumber(distance)} mi`;

  const metricLabel =
    distance >= 1000
      ? formatScaleDistance(distance / 1000, 'km')
      : formatScaleDistance(distance, 'm');
  const imperialLabel =
    distance >= 1000
      ? formatScaleDistance(distance / METERS_PER_MILE, 'mi')
      : formatScaleDistance(Math.round(distance / METERS_PER_FOOT), 'ft');

  if (!metricLabel || !imperialLabel) return null;
  if (unit === 'metric') return metricLabel;
  if (unit === 'imperial') return imperialLabel;
  return `${metricLabel} / ${imperialLabel}`;
}

export function selectScaleDistance(metersPerPixel: number, maxWidth: number): ScaleDistance | null {
  const maximumDistance = metersPerPixel * maxWidth;
  if (!Number.isFinite(maximumDistance) || maximumDistance <= 0) return null;

  const exponent = Math.floor(Math.log10(maximumDistance));
  const base = 10 ** exponent;
  const coefficient = [5, 2, 1].find((value) => value * base <= maximumDistance);
  if (!coefficient) return null;

  const distance = coefficient * base;
  const metricLabel = formatScaleDistance(distance, 'metric');
  const imperialLabel = formatScaleDistance(distance, 'imperial');
  if (!metricLabel || !imperialLabel) return null;

  return {
    distance,
    width: distance / metersPerPixel,
    metricLabel,
    imperialLabel,
    dualLabel: `${metricLabel} / ${imperialLabel}`,
  };
}

export class ScaleCalculator {
  private readonly _transformers = new Map<string, Promise<GeographicCoordinateTransformer>>();

  async getMetrics(view: ScaleView, options: GetScaleMetricsOptions = {}): Promise<ScaleMetrics | null> {
    if (!Number.isFinite(view.width) || !Number.isFinite(view.height) || view.width <= 0 || view.height <= 0) {
      return null;
    }

    try {
      const { definition, signature } = await resolveProjectCrsDefinition(view.crs);
      const transformer = await this._getTransformer(signature, definition);
      const requestedMethod = options.calculationMethod ?? 'center';
      const calculationMethod =
        requestedMethod === 'equator' && !transformer.isGeographic ? 'center' : requestedMethod;
      const geodesic = new Geodesic.Geodesic(transformer.semiMajorAxis, transformer.flattening);
      const metersPerPixel = this._measure(view, transformer, geodesic, calculationMethod);
      if (metersPerPixel === null || !Number.isFinite(metersPerPixel) || metersPerPixel <= 0) {
        return null;
      }

      return {
        metersPerPixel,
        scaleDenominator: (metersPerPixel * (options.dpi ?? 96)) / 0.0254,
        calculationMethod,
      };
    } catch {
      return null;
    }
  }

  private _getTransformer(signature: string, definition: string): Promise<GeographicCoordinateTransformer> {
    let transformer = this._transformers.get(signature);
    if (!transformer) {
      transformer = Promise.resolve().then(() => createGeographicCoordinateTransformer(definition));
      this._transformers.set(signature, transformer);
    }
    return transformer;
  }

  private _measure(
    view: ScaleView,
    transformer: GeographicCoordinateTransformer,
    geodesic: InstanceType<typeof Geodesic.Geodesic>,
    method: ScaleCalculationMethod,
  ): number | null {
    if (method === 'average') {
      const samples = [0, view.height / 2, view.height]
        .map((row) => this._sample(view, transformer, geodesic, row))
        .filter((sample): sample is number => sample !== null);
      if (samples.length === 0) return null;
      return samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
    }

    const row = method === 'top' ? 0 : method === 'bottom' ? view.height : view.height / 2;
    const sample = this._coordinatesAt(view, transformer, row);
    if (!sample) return null;
    const [first, second] = sample;
    if (method === 'equator') return this._geodesicDistance(geodesic, [first[0], 0], [second[0], 0]);
    return this._geodesicDistance(geodesic, first, second);
  }

  private _sample(
    view: ScaleView,
    transformer: GeographicCoordinateTransformer,
    geodesic: InstanceType<typeof Geodesic.Geodesic>,
    row: number,
  ): number | null {
    const sample = this._coordinatesAt(view, transformer, row);
    return sample ? this._geodesicDistance(geodesic, sample[0], sample[1]) : null;
  }

  private _coordinatesAt(
    view: ScaleView,
    transformer: GeographicCoordinateTransformer,
    row: number,
  ): [[number, number], [number, number]] | null {
    try {
      const x = view.width / 2;
      const first = transformer.inverse(view.unproject(x, row));
      const second = transformer.inverse(view.unproject(x + 1, row));
      return first && second ? [first, second] : null;
    } catch {
      return null;
    }
  }

  private _geodesicDistance(
    geodesic: InstanceType<typeof Geodesic.Geodesic>,
    first: [number, number],
    second: [number, number],
  ): number | null {
    const distance = geodesic.Inverse(first[1], first[0], second[1], second[0]).s12;
    return distance !== undefined && Number.isFinite(distance) ? Math.abs(distance) : null;
  }
}
