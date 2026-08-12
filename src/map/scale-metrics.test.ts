// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { Bounds } from '../geo/bounds';
import { Emap } from './map';

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
});
