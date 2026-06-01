// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { Emap } from '../map/map';

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
  it('keyed on() delivers the typed payload at runtime', () => {
    const map = new Emap({ container: container() });
    const seen: Array<{ type: string; center?: [number, number] }> = [];
    map.on('moveend', (e) => seen.push({ type: e.type, center: e.center }));
    map.jumpTo({ center: [3, 4], scale: 2 });
    const end = seen.find((s) => s.type === 'moveend');
    expect(end).toBeDefined();
    expect(end!.center).toEqual([3, 4]);
  });

  it('off() unsubscribes a keyed listener', () => {
    const map = new Emap({ container: container() });
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

  it('escape-hatch custom event still fires through the generic path', () => {
    const map = new Emap({ container: container() });
    let got = '';
    map.on('myCustomThing', (e: { type: string; payload?: string }) => {
      got = e.payload ?? '';
    });
    map.fire('myCustomThing', { payload: 'hi' });
    expect(got).toBe('hi');
  });
});
