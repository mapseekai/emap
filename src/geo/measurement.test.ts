import { describe, expect, it } from 'vitest';
import {
  calculateSphericalArea,
  formatMeasurement,
  MeasurementCalculator,
} from './measurement';

describe('MeasurementCalculator', () => {
  it('measures one degree at the equator using the WGS84 ellipsoid', async () => {
    const context = await new MeasurementCalculator().getContext('EPSG:4326');

    expect(context).not.toBeNull();
    expect(context!.length([[0, 0], [1, 0]])).toBeCloseTo(111_319.490793, 4);
  });

  it('does not add distance for adjacent duplicate vertices', async () => {
    const context = await new MeasurementCalculator().getContext('EPSG:4326');

    expect(context).not.toBeNull();
    expect(context!.length([[0, 0], [0, 0], [1, 0]])).toBeCloseTo(111_319.490793, 4);
  });

  it('uses Mapshaper spherical-ring semantics for a one-degree square', () => {
    expect(calculateSphericalArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBeCloseTo(
      12_391_399_902.071,
      3,
    );
  });

  it('keeps a date-line-crossing one-degree square equal to its prime-meridian counterpart', () => {
    const area = calculateSphericalArea([[179, 0], [-179, 0], [-179, 1], [179, 1]]);

    expect(area).toBeCloseTo(2 * 12_391_399_902.071, 3);
  });

  it('returns no area for fewer than three vertices', () => {
    expect(calculateSphericalArea([[0, 0], [1, 0]])).toBeNull();
  });

  it('round-trips WGS84 through a projected CRS and rejects a non-Earth CRS', async () => {
    const calculator = new MeasurementCalculator();
    const webMercator = await calculator.getContext('EPSG:3857');

    expect(webMercator).not.toBeNull();
    const projected = webMercator!.forward([1, 0]);
    expect(projected).not.toBeNull();
    const geographic = webMercator!.inverse(projected!);
    expect(geographic).not.toBeNull();
    expect(geographic![0]).toBeCloseTo(1, 9);
    expect(geographic![1]).toBeCloseTo(0, 9);
    await expect(calculator.getContext('+proj=longlat +a=3396190 +b=3396190 +no_defs')).resolves.toBeNull();
  });
});

describe('formatMeasurement', () => {
  it('uses metric length and area units at the documented thresholds', () => {
    expect(formatMeasurement('length', 500)).toBe('500 m');
    expect(formatMeasurement('length', 2_500)).toBe('2.5 km');
    expect(formatMeasurement('area', 500_000)).toBe('500000 m²');
    expect(formatMeasurement('area', 2_500_000)).toBe('2.5 km²');
  });

  it('does not format unavailable or invalid values', () => {
    expect(formatMeasurement('length', null)).toBeNull();
    expect(formatMeasurement('area', Number.NaN)).toBeNull();
  });
});
