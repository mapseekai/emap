// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { GetScaleMetricsOptions, ScaleMetrics } from '../index';
import { Bounds } from '../geo/bounds';
import type { ScaleView } from '../geo/scale-calculator';
import { Emap } from './map';

const rootExportedMetricTypes: [GetScaleMetricsOptions, ScaleMetrics] = [
  { calculationMethod: 'center' },
  { metersPerPixel: 1, scaleDenominator: 1, calculationMethod: 'center' },
];
void rootExportedMetricTypes;

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () =>
    ({
      scale: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      setTransform: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 0 }),
    }) as CanvasRenderingContext2D;
});

function container(width = 800, height = 600): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientWidth: { value: width },
    clientHeight: { value: height },
  });
  document.body.appendChild(element);
  return element;
}

function resizableContainer(width = 800, height = 600) {
  let currentWidth = width;
  let currentHeight = height;
  const element = document.createElement('div');
  Object.defineProperties(element, {
    clientWidth: { get: () => currentWidth },
    clientHeight: { get: () => currentHeight },
  });
  document.body.appendChild(element);
  return {
    element,
    setSize(nextWidth: number, nextHeight: number): void {
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function deferScaleCalculation(map: Emap) {
  const pending = deferred<ScaleMetrics | null>();
  Reflect.set(map, '_scaleCalculator', {
    getMetrics: (_view: ScaleView) => pending.promise,
  });
  return pending;
}

describe('Emap scale metrics', () => {
  it('reports Earth scale metrics and adds zoom only for Web Mercator', async () => {
    const map = new Emap({ container: container() });
    map.setCRS('EPSG:4326');
    map.setExtent(new Bounds(-1, -1, 1, 1));

    const metrics = await map.getScaleMetrics();

    expect(metrics).toMatchObject({
      metersPerPixel: expect.any(Number),
      scaleDenominator: expect.any(Number),
    });
    expect(metrics?.zoom).toBeUndefined();

    map.setCRS('EPSG:3857');
    map.setExtent(new Bounds(-1000, -1000, 1000, 1000));

    const webMercator = await map.getScaleMetrics();

    expect(webMercator?.zoom).toEqual(expect.any(Number));
    map.remove();
  });

  it('returns null for an empty, zero-sized view', async () => {
    const map = new Emap({ container: container(0, 0) });

    await expect(map.getScaleMetrics()).resolves.toBeNull();
    map.remove();
  });

  it('returns null when the CRS changes while metrics are pending', async () => {
    const map = new Emap({ container: container() });
    map.setCRS('EPSG:4326');
    map.setExtent(new Bounds(-1, -1, 1, 1));
    const pending = deferScaleCalculation(map);

    const result = map.getScaleMetrics();
    map.setCRS('EPSG:3857');
    pending.resolve({ metersPerPixel: 1, scaleDenominator: 3779.5, calculationMethod: 'center' });

    await expect(result).resolves.toBeNull();
    map.remove();
  });

  it('returns null when the view moves while metrics are pending', async () => {
    const map = new Emap({ container: container() });
    map.setCRS('EPSG:4326');
    map.setExtent(new Bounds(-1, -1, 1, 1));
    const pending = deferScaleCalculation(map);

    const result = map.getScaleMetrics();
    map.setExtent(new Bounds(10, 10, 12, 12));
    pending.resolve({ metersPerPixel: 1, scaleDenominator: 3779.5, calculationMethod: 'center' });

    await expect(result).resolves.toBeNull();
    map.remove();
  });

  it('returns null when the viewport resizes while metrics are pending', async () => {
    const host = resizableContainer();
    const map = new Emap({ container: host.element });
    map.setCRS('EPSG:4326');
    map.setExtent(new Bounds(-1, -1, 1, 1));
    const pending = deferScaleCalculation(map);

    const result = map.getScaleMetrics();
    host.setSize(640, 480);
    map.resize();
    pending.resolve({ metersPerPixel: 1, scaleDenominator: 3779.5, calculationMethod: 'center' });

    await expect(result).resolves.toBeNull();
    map.remove();
  });

  it('uses zoom from the same snapshot as the measured view', async () => {
    const map = new Emap({ container: container() });
    map.setCRS('EPSG:3857');
    map.setExtent(new Bounds(-1000, -1000, 1000, 1000));
    const pending = deferScaleCalculation(map);
    let snapshotZoom = 4;
    vi.spyOn(map, 'getZoom').mockImplementation(() => snapshotZoom);

    const result = map.getScaleMetrics();
    snapshotZoom = 9;
    pending.resolve({ metersPerPixel: 1, scaleDenominator: 3779.5, calculationMethod: 'center' });

    await expect(result).resolves.toMatchObject({ zoom: 4 });
    map.remove();
  });
});
