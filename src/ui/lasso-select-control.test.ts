// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  LassoSelectControl,
  featureMatchesLasso,
  pointInPolygon,
} from './lasso-select-control';

interface FakeMap {
  getCanvasContainer: () => HTMLElement;
  queryFeatures: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  getSource: ReturnType<typeof vi.fn>;
  project: ReturnType<typeof vi.fn>;
}

function makeFakeMap(canvasContainer: HTMLElement): FakeMap {
  return {
    getCanvasContainer: () => canvasContainer,
    queryFeatures: vi.fn(() => []),
    select: vi.fn(),
    getSource: vi.fn(),
    project: vi.fn((x: number, y: number) => [x, y]), // identity transform
  };
}

function dispatch(el: EventTarget, type: string, opts: {
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  button?: number;
  clientX?: number;
  clientY?: number;
} = {}): void {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button ?? 0,
    shiftKey: !!opts.shiftKey,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    altKey: !!opts.altKey,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  });
  el.dispatchEvent(e);
}

function makePathSource(layer: { name: string; geometry_type: 'polyline' | 'polygon'; shapes: any[] }, paths: Record<number, Array<[number, number]>>) {
  return {
    getDataset: () => ({ layers: [layer] }),
    getArcs: () => ({
      getShapeIter: (part: number[]) => {
        const points = paths[part[0]] ?? [];
        let i = -1;
        return {
          x: 0,
          y: 0,
          hasNext() {
            i++;
            const p = points[i];
            if (!p) return false;
            this.x = p[0];
            this.y = p[1];
            return true;
          },
        };
      },
      getArcIter: vi.fn(),
    }),
  };
}

describe('pointInPolygon', () => {
  // Unit square 0..10 in both dims.
  const square: Array<[number, number]> = [
    [0, 0], [10, 0], [10, 10], [0, 10],
  ];

  it('returns true for points strictly inside', () => {
    expect(pointInPolygon([5, 5], square)).toBe(true);
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([9, 9], square)).toBe(true);
  });

  it('returns false for points strictly outside', () => {
    expect(pointInPolygon([-1, 5], square)).toBe(false);
    expect(pointInPolygon([5, -1], square)).toBe(false);
    expect(pointInPolygon([11, 5], square)).toBe(false);
    expect(pointInPolygon([5, 11], square)).toBe(false);
  });

  it('handles a closed polygon (last == first) the same as open', () => {
    const closed: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
    expect(pointInPolygon([5, 5], closed)).toBe(true);
    expect(pointInPolygon([15, 5], closed)).toBe(false);
  });

  it('triangle: contains its centroid, excludes its outside', () => {
    const tri: Array<[number, number]> = [[0, 0], [10, 0], [5, 10]];
    expect(pointInPolygon([5, 3], tri)).toBe(true);
    expect(pointInPolygon([5, -1], tri)).toBe(false);
    expect(pointInPolygon([0, 8], tri)).toBe(false);
  });
});

describe('featureMatchesLasso', () => {
  const lasso: Array<[number, number]> = [
    [100, 100], [200, 100], [200, 200], [100, 200], [100, 100],
  ];

  it('matches a polyline that crosses the lasso when intersecting is enabled', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() => makePathSource(
        { name: 'l', geometry_type: 'polyline', shapes: [[[0]]] },
        { 0: [[50, 150], [250, 150]] },
      )),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });

  it('matches a polygon that fully covers the lasso in intersecting mode', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() => makePathSource(
        { name: 'l', geometry_type: 'polygon', shapes: [[[0]]] },
        { 0: [[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]] },
      )),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });

  it('requires every point in a multi-point feature to be inside in containment mode', () => {
    const map: any = {
      project: vi.fn((x: number, y: number) => [x, y]),
      getSource: vi.fn(() => ({
        getDataset: () => ({
          layers: [{ name: 'l', geometry_type: 'point', shapes: [
            [[150, 150], [250, 250]],
          ] }],
        }),
        getArcs: () => undefined,
      })),
    };
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, true)).toBe(true);
    expect(featureMatchesLasso(map, { source: 's', layer: 'l', id: 0 }, lasso, false)).toBe(false);
  });
});

describe('LassoSelectControl', () => {
  let canvasContainer: HTMLElement;
  let map: FakeMap;
  let control: LassoSelectControl;

  beforeEach(() => {
    canvasContainer = document.createElement('div');
    canvasContainer.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600,
      width: 800, height: 600, toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(canvasContainer);

    map = makeFakeMap(canvasContainer);
    control = new LassoSelectControl();
    const anchor = control.onAdd(map as any);
    document.body.appendChild(anchor);
  });

  afterEach(() => {
    control.onRemove();
    canvasContainer.remove();
  });

  function drawLasso(points: Array<[number, number]>, mods: { ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean } = {}): void {
    const opts = { shiftKey: true, ...mods };
    dispatch(canvasContainer, 'mousedown', { ...opts, clientX: points[0][0], clientY: points[0][1] });
    for (let i = 1; i < points.length; i++) {
      dispatch(window, 'mousemove', { ...opts, clientX: points[i][0], clientY: points[i][1] });
    }
    dispatch(window, 'mouseup', { ...opts, clientX: points[points.length - 1][0], clientY: points[points.length - 1][1] });
  }

  it('shift-drag along a polygon path selects point features inside (replace mode)', () => {
    // Two candidates returned by queryFeatures; only id=1 is inside.
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 1, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'l', id: 2, geometryType: 'polygon', properties: {} },
    ]);
    map.getSource.mockImplementation(() => ({
      getDataset: () => ({
        layers: [{ name: 'l', geometry_type: 'point', shapes: [
          [[0, 0]],
          [[150, 150]], // inside the lasso below
          [[500, 500]], // outside
        ] }],
      }),
      getArcs: () => undefined,
    }));

    // Triangle bounded by (100,100)-(200,100)-(150,200).
    drawLasso([[100, 100], [200, 100], [150, 200]]);

    expect(map.queryFeatures).toHaveBeenCalledTimes(1);
    expect(map.select).toHaveBeenCalledTimes(1);
    expect(map.select.mock.calls[0][0]).toEqual([
      { source: 's', layer: 'l', id: 1 },
    ]);
    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'replace' });
  });

  it('default mode selects path features that intersect the lasso even when endpoints are outside', () => {
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 0, geometryType: 'polyline', properties: {} },
    ]);
    map.getSource.mockImplementation(() => makePathSource(
      { name: 'l', geometry_type: 'polyline', shapes: [[[0]]] },
      { 0: [[50, 150], [250, 150]] },
    ));

    drawLasso([[100, 100], [200, 100], [200, 200], [100, 200]]);

    expect(map.select.mock.calls[0][0]).toEqual([
      { source: 's', layer: 'l', id: 0 },
    ]);
  });

  it('includeIntersecting=false excludes partially crossing path features', () => {
    control.onRemove();
    control = new LassoSelectControl({ includeIntersecting: false });
    document.body.appendChild(control.onAdd(map as any));
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 0, geometryType: 'polyline', properties: {} },
    ]);
    map.getSource.mockImplementation(() => makePathSource(
      { name: 'l', geometry_type: 'polyline', shapes: [[[0]]] },
      { 0: [[50, 150], [250, 150]] },
    ));

    drawLasso([[100, 100], [200, 100], [200, 200], [100, 200]]);

    expect(map.select.mock.calls[0][0]).toEqual([]);
  });

  it('plain (non-shift) mousedown is left for the pan handler', () => {
    dispatch(canvasContainer, 'mousedown', { clientX: 100, clientY: 100 });
    dispatch(window, 'mousemove', { clientX: 200, clientY: 200 });
    dispatch(window, 'mouseup', { clientX: 200, clientY: 200 });
    expect(map.queryFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('path with fewer than 3 points is a no-op', () => {
    drawLasso([[100, 100], [200, 200]]); // only 2 points captured
    expect(map.queryFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('drag below threshold is a no-op', () => {
    drawLasso([[100, 100], [101, 101], [102, 102]]); // bbox 0..2 px
    expect(map.queryFeatures).not.toHaveBeenCalled();
  });

  it('shift+ctrl → add mode', () => {
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 0, geometryType: 'polygon', properties: {} },
    ]);
    map.getSource.mockImplementation(() => ({
      getDataset: () => ({
        layers: [{ name: 'l', geometry_type: 'point', shapes: [[[150, 150]]] }],
      }),
    }));
    drawLasso([[100, 100], [200, 100], [150, 200]], { ctrlKey: true });
    expect(map.select).toHaveBeenCalled();
    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'add' });
  });

  it('shift+meta → add mode (Mac)', () => {
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 0, geometryType: 'polygon', properties: {} },
    ]);
    map.getSource.mockImplementation(() => ({
      getDataset: () => ({
        layers: [{ name: 'l', geometry_type: 'point', shapes: [[[150, 150]]] }],
      }),
    }));
    drawLasso([[100, 100], [200, 100], [150, 200]], { metaKey: true });
    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'add' });
  });

  it('shift+alt → toggle mode', () => {
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'l', id: 0, geometryType: 'polygon', properties: {} },
    ]);
    map.getSource.mockImplementation(() => ({
      getDataset: () => ({
        layers: [{ name: 'l', geometry_type: 'point', shapes: [[[150, 150]]] }],
      }),
    }));
    drawLasso([[100, 100], [200, 100], [150, 200]], { altKey: true });
    expect(map.select.mock.calls[0][1]).toEqual({ mode: 'toggle' });
  });

  it('dedupes refs across visible layers backed by same feature', () => {
    map.queryFeatures.mockReturnValueOnce([
      { source: 's', layer: 'fill', id: 0, geometryType: 'polygon', properties: {} },
      { source: 's', layer: 'fill', id: 0, geometryType: 'polygon', properties: {} }, // dup
      { source: 's', layer: 'line', id: 0, geometryType: 'polygon', properties: {} }, // different layer
    ]);
    map.getSource.mockImplementation((id: string) => ({
      getDataset: () => ({
        layers: [
          { name: 'fill', geometry_type: 'point', shapes: [[[150, 150]]] },
          { name: 'line', geometry_type: 'point', shapes: [[[150, 150]]] },
        ],
      }),
    }));
    drawLasso([[100, 100], [200, 100], [150, 200]]);
    const refs = map.select.mock.calls[0][0];
    expect(refs).toEqual([
      { source: 's', layer: 'fill', id: 0 },
      { source: 's', layer: 'line', id: 0 },
    ]);
  });

  it('disable() makes shift+drag a no-op', () => {
    control.disable();
    expect(control.isEnabled()).toBe(false);
    drawLasso([[100, 100], [200, 100], [150, 200]]);
    expect(map.queryFeatures).not.toHaveBeenCalled();
    expect(map.select).not.toHaveBeenCalled();
  });

  it('forwards layers filter to queryFeatures', () => {
    control.onRemove();
    control = new LassoSelectControl({ layers: ['only-this'] });
    document.body.appendChild(control.onAdd(map as any));
    map.queryFeatures.mockReturnValueOnce([]);
    drawLasso([[100, 100], [200, 100], [150, 200]]);
    expect(map.queryFeatures.mock.calls[0][1]).toEqual({ layers: ['only-this'] });
  });
});
