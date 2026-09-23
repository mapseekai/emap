// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { Emap } from '../map/map';
import { TopologySource } from '../../domain/source/topology-source';
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
    }) as any;
});
function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}
describe('EmapEventMap runtime wiring (DX P10)', () => {
  it('keyed on() delivers the typed payload at runtime', async () => {
    const map = await Emap.create({ container: container(), renderer: 'canvas2d' });
    const seen: Array<{
      type: string;
      center?: [number, number];
    }> = [];
    map.on('moveend', (e) => seen.push({ type: e.type, center: e.center }));
    map.jumpTo({ center: [3, 4], scale: 2 });
    const end = seen.find((s) => s.type === 'moveend');
    expect(end).toBeDefined();
    expect(end!.center).toEqual([3, 4]);
  });
  it('off() unsubscribes a keyed listener', async () => {
    const map = await Emap.create({ container: container(), renderer: 'canvas2d' });
    let n = 0;
    const cb = () => {
      n++;
    };
    map.on('moveend', cb);
    map.jumpTo({ center: [1, 1], scale: 2 });
    map.off('moveend', cb);
    map.jumpTo({ center: [2, 2], scale: 2 });
    expect(n).toBe(1);
  });
  it('escape-hatch custom event still fires through the generic path', async () => {
    const map = await Emap.create({ container: container(), renderer: 'canvas2d' });
    let got = '';
    map.on('myCustomThing', (e: { type: string; payload?: string }) => {
      got = e.payload ?? '';
    });
    map.fire('myCustomThing', { payload: 'hi' });
    expect(got).toBe('hi');
  });
  it('delivers a cloned rendered-layer snapshot through the keyed listener', async () => {
    const map = await Emap.create({ container: container(), renderer: 'canvas2d' });
    const source = new TopologySource('runtime');
    source.setDataset({ layers: [], info: { crs_string: 'EPSG:4326' } });
    const seen: unknown[] = [];
    const committedSources: unknown[] = [];
    map.on('layerchange', (event) => {
      seen.push(event);
      committedSources.push(map.getSource('runtime'));
    });
    await map.addSource('runtime', source);
    expect(seen).toMatchObject([
      {
        type: 'layerchange',
        reason: 'effective',
        layers: [{ id: 'runtime:default', source: 'runtime' }],
      },
    ]);
    expect(committedSources).toEqual([source]);
    seen.length = 0;
    map.addLayer({
      id: 'runtime-line',
      type: 'line',
      source: 'runtime',
      paint: { 'line-color': '#123456' },
    });
    expect(seen).toHaveLength(1);
    const event = seen[0] as {
      type: string;
      reason: string;
      layerId?: string;
      layers: Array<{
        paint?: {
          'line-color'?: string;
        };
      }>;
    };
    expect(event).toMatchObject({
      type: 'layerchange',
      reason: 'add',
      layerId: 'runtime-line',
      layers: [{ id: 'runtime-line', paint: { 'line-color': '#123456' } }],
    });
    event.layers[0].paint!['line-color'] = '#ffffff';
    expect(map.getRenderedLayers()[0].paint).toMatchObject({ 'line-color': '#123456' });
  });
});
