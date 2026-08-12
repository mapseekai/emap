import { describe, expect, it } from 'vitest';
import { formatScaleDistance, ScaleCalculator, selectScaleDistance } from './scale-calculator';

function geographicView(latitude: number) {
  return {
    crs: 'EPSG:4326',
    width: 200,
    height: 100,
    unproject: (px: number, py: number): [number, number] => [
      -1 + px / 100,
      latitude + (50 - py) / 100,
    ],
  };
}

function projectedView(crs: string, origin: [number, number]) {
  return {
    crs,
    width: 200,
    height: 100,
    unproject: (px: number, py: number): [number, number] => [
      origin[0] + px * 100,
      origin[1] + (50 - py) * 100,
    ],
  };
}

describe('ScaleCalculator', () => {
  it('reports fewer metres per pixel at 60° latitude than at the equator', async () => {
    const calculator = new ScaleCalculator();
    const equator = await calculator.getMetrics(geographicView(0));
    const highLatitude = await calculator.getMetrics(geographicView(60));

    expect(equator).not.toBeNull();
    expect(highLatitude).not.toBeNull();
    expect(highLatitude!.metersPerPixel / equator!.metersPerPixel).toBeCloseTo(0.5, 2);
  });

  it('uses center samples for projected CRS views', async () => {
    const calculator = new ScaleCalculator();
    const webMercatorView = projectedView('EPSG:3857', [0, 0]);
    const utmView = projectedView('EPSG:32633', [500000, 0]);

    expect(await calculator.getMetrics(webMercatorView)).toMatchObject({ calculationMethod: 'center' });
    expect(await calculator.getMetrics(utmView)).toMatchObject({ calculationMethod: 'center' });
  });

  it('returns null for invalid CRS views', async () => {
    const calculator = new ScaleCalculator();
    const invalidView = { ...geographicView(0), crs: 'EPSG:999999999' };

    expect(await calculator.getMetrics(invalidView)).toBeNull();
  });

  it('falls back from equator to center for projected views', async () => {
    const calculator = new ScaleCalculator();
    const projected = projectedView('EPSG:3857', [0, 0]);

    expect((await calculator.getMetrics(projected, { calculationMethod: 'equator' }))?.calculationMethod).toBe(
      'center',
    );
  });

  it('uses the requested DPI without snapping the denominator', async () => {
    const calculator = new ScaleCalculator();
    const at96Dpi = await calculator.getMetrics(geographicView(45), { dpi: 96 });
    const at192Dpi = await calculator.getMetrics(geographicView(45), { dpi: 192 });

    expect(at96Dpi).not.toBeNull();
    expect(at192Dpi).not.toBeNull();
    expect(at192Dpi!.scaleDenominator).toBeCloseTo(at96Dpi!.scaleDenominator * 2);
  });
});

describe('scale distance helpers', () => {
  it('selects 1 / 2 / 5 × 10^n distances within the available width', () => {
    expect(selectScaleDistance(4, 80)).toMatchObject({ distance: 200, width: 50 });
    expect(selectScaleDistance(4, 49)).toMatchObject({ distance: 100, width: 25 });
    expect(selectScaleDistance(4, 24)).toMatchObject({ distance: 50, width: 12.5 });
  });

  it('formats metric, imperial, and dual labels', () => {
    expect(formatScaleDistance(200, 'metric')).toBe('200 m');
    expect(formatScaleDistance(2000, 'metric')).toBe('2 km');
    expect(formatScaleDistance(200, 'imperial')).toBe('656 ft');
    expect(formatScaleDistance(0.12, 'mi')).toBe('0.12 mi');
    expect(formatScaleDistance(200, 'dual')).toBe('200 m / 656 ft');
  });

  it('returns no label for non-finite distances', () => {
    expect(formatScaleDistance(Number.NaN, 'metric')).toBeNull();
    expect(selectScaleDistance(Number.POSITIVE_INFINITY, 80)).toBeNull();
  });
});
