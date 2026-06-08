// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { VertexEditHandler } from './vertex-edit';

type MockMap = {
  getCanvasContainer: () => { getBoundingClientRect: () => { left: number; top: number } };
  unproject: (px: number, py: number) => [number, number];
  setEditVertexState: (state: unknown) => void;
  render: () => void;
  fire: (type: string, payload: unknown) => void;
  getSource?: (id: string) =>
    | {
        refreshDisplayArcs?: () => void;
        markDisplayArcsDirty?: () => void;
        getDataset?: () => unknown;
      }
    | undefined;
};

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

function callPrivate(target: object, key: string, ...args: unknown[]): unknown {
  const fn = Reflect.get(target, key);
  if (typeof fn !== 'function') {
    throw new Error(`Expected ${key} to be a function`);
  }
  return (fn as (...input: unknown[]) => unknown).apply(target, args);
}

function makeArcIter(points: Array<[number, number]>): {
  x: number;
  y: number;
  hasNext(): boolean;
} {
  let i = -1;
  return {
    get x() {
      return points[i]?.[0] ?? 0;
    },
    get y() {
      return points[i]?.[1] ?? 0;
    },
    hasNext() {
      i++;
      return i < points.length;
    },
  };
}

describe('VertexEditHandler', () => {
  const originalFindNearestVertices = Reflect.get(
    mapshaper.internal as object,
    'findNearestVertices',
  );
  const originalSnapVerticesToPoint = Reflect.get(
    mapshaper.internal as object,
    'snapVerticesToPoint',
  );
  const originalForEachSegmentInShape = Reflect.get(
    mapshaper.internal as object,
    'forEachSegmentInShape',
  );
  const originalFindClosestPointOnSeg = Reflect.get(
    mapshaper.internal as object,
    'findClosestPointOnSeg',
  );

  beforeEach(() => {
    Reflect.set(
      mapshaper.internal as object,
      'findNearestVertices',
      vi.fn(() => []),
    );
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', vi.fn());
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', originalFindNearestVertices);
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', originalSnapVerticesToPoint);
    Reflect.set(
      mapshaper.internal as object,
      'forEachSegmentInShape',
      originalForEachSegmentInShape,
    );
    Reflect.set(
      mapshaper.internal as object,
      'findClosestPointOnSeg',
      originalFindClosestPointOnSeg,
    );
  });

  it('uses a light green polygon fill by default', () => {
    const handler = new VertexEditHandler({} as any);

    expect(handler.getOptions().polygonFillColor).toBe('rgba(76,175,80,0.2)');
  });

  it('moves all shared vertices during drag', () => {
    const mapMock: MockMap = {
      getCanvasContainer: () => ({
        getBoundingClientRect: () => ({ left: 10, top: 20 }),
      }),
      unproject: () => [11, 22],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };

    const handler = new VertexEditHandler(mapMock as any);
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);

    setPrivate(handler, '_map', mapMock);
    setPrivate(handler, '_hoverVertexIds', [4, 9, 11]);
    setPrivate(handler, '_hoveredFeature', {
      id: 2,
      source: 'src-a',
      layer: 'layer-a',
      shape: [[1]],
      arcs: {
        getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }),
        getVertex2: () => [0, 0],
      },
      geometryType: 'polyline',
    });

    // clientX:100, clientY:120, rect left:10, top:20 → px=90, py=100
    callPrivate(handler, '_handleDrag', 90, 100);

    expect(snapSpy).toHaveBeenCalledWith([4, 9, 11], [11, 22], expect.any(Object));
    expect(mapMock.render).toHaveBeenCalled();
  });

  it('snaps dragged vertices to other feature vertices when drag snap is enabled', () => {
    const movingShape = [[0]];
    const targetShape = [[1]];
    const xx = new Float64Array([0, 0, 10, 20]);
    const yy = new Float64Array([0, 0, 0, 0]);
    const mapMock = {
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      queryFeatures: vi.fn(() => [
        { id: 1, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [
          { name: 'roads', geometry_type: 'polyline', shapes: [movingShape, targetShape] },
        ],
        getArcs: () => ({
          getVertex2: () => [0, 0],
          getSimpleShapeBbox: (_part: number[], bbox: number[]) => {
            bbox[0] = 0;
            bbox[1] = 0;
            bbox[2] = 20;
            bbox[3] = 0;
          },
        }),
      })),
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    Reflect.set(
      mapshaper.internal as object,
      'forEachSegmentInShape',
      vi.fn((shape, _arcs, cb) => {
        expect(shape).toEqual(targetShape);
        cb(2, 3, xx, yy);
      }),
    );

    const handler = new VertexEditHandler(mapMock as any, { snapThreshold: 5, snapToEdge: false });
    setPrivate(handler, '_map', mapMock);
    setPrivate(handler, '_hoverVertexIds', [0]);
    setPrivate(handler, '_hoveredFeature', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: movingShape,
      arcs: { getVertex2: () => [0, 0] },
      geometryType: 'polyline',
      allLayers: [],
    });

    callPrivate(handler, '_handleDrag', 11, 0);

    expect(snapSpy).toHaveBeenCalledWith([0], [10, 0], expect.any(Object));
    expect(mapMock.queryFeatures).toHaveBeenCalledWith(
      [
        [6, -5],
        [16, 5],
      ],
      undefined,
    );
  });

  it('limits drag snap scanning to spatial query hits', () => {
    const movingShape = [[0]];
    const farShape = [[1]];
    const targetShape = [[2]];
    const xx = new Float64Array([0, 0, 1000, 1010, 10, 20]);
    const yy = new Float64Array([0, 0, 1000, 1010, 0, 0]);
    const mapMock = {
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      queryFeatures: vi.fn(() => [
        { id: 2, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [
          {
            name: 'roads',
            geometry_type: 'polyline',
            shapes: [movingShape, farShape, targetShape],
          },
        ],
        getArcs: () => ({
          getVertex2: () => [0, 0],
          getSimpleShapeBbox: (part: number[], bbox: number[]) => {
            if (part === targetShape[0]) {
              bbox[0] = 10;
              bbox[1] = 0;
              bbox[2] = 20;
              bbox[3] = 0;
            } else {
              bbox[0] = 1000;
              bbox[1] = 1000;
              bbox[2] = 1010;
              bbox[3] = 1010;
            }
          },
        }),
      })),
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const snapSpy = vi.fn();
    const segmentSpy = vi.fn((shape, _arcs, cb) => {
      expect(shape).toEqual(targetShape);
      cb(4, 5, xx, yy);
    });
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    Reflect.set(mapshaper.internal as object, 'forEachSegmentInShape', segmentSpy);

    const handler = new VertexEditHandler(mapMock as any, { snapThreshold: 5, snapToEdge: false });
    setPrivate(handler, '_map', mapMock);
    setPrivate(handler, '_hoverVertexIds', [0]);
    setPrivate(handler, '_hoveredFeature', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: movingShape,
      arcs: { getVertex2: () => [0, 0] },
      geometryType: 'polyline',
      allLayers: [],
    });

    callPrivate(handler, '_handleDrag', 11, 0);

    expect(segmentSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy).toHaveBeenCalledWith([0], [10, 0], expect.any(Object));
  });

  it('does not keep an unbounded seen-vertex set while drag snapping', () => {
    const movingShape = [[0]];
    const targetShape = [[1]];
    const xx = new Float64Array([0, 0, 10, 20]);
    const yy = new Float64Array([0, 0, 0, 0]);
    const mapMock = {
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      queryFeatures: vi.fn(() => [
        { id: 1, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [
          { name: 'roads', geometry_type: 'polyline', shapes: [movingShape, targetShape] },
        ],
        getArcs: () => ({
          getVertex2: () => [0, 0],
          getSimpleShapeBbox: (_part: number[], bbox: number[]) => {
            bbox[0] = 0;
            bbox[1] = 0;
            bbox[2] = 20;
            bbox[3] = 0;
          },
        }),
      })),
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const originalSetAdd = Set.prototype.add;
    Reflect.set(
      mapshaper.internal as object,
      'forEachSegmentInShape',
      vi.fn((_shape, _arcs, cb) => {
        cb(2, 3, xx, yy);
      }),
    );
    Set.prototype.add = function add(value: unknown) {
      if (value !== 0) throw new Error('unexpected unbounded Set.add');
      return originalSetAdd.call(this, value);
    };

    try {
      const handler = new VertexEditHandler(mapMock as any, {
        snapThreshold: 5,
        snapToEdge: false,
      });
      setPrivate(handler, '_map', mapMock);
      setPrivate(handler, '_hoverVertexIds', [0]);
      setPrivate(handler, '_hoveredFeature', {
        id: 0,
        source: 'src-a',
        layer: 'roads',
        shape: movingShape,
        arcs: { getVertex2: () => [0, 0] },
        geometryType: 'polyline',
        allLayers: [],
      });

      expect(() => callPrivate(handler, '_findDragSnapTarget', 11, 0)).not.toThrow();
    } finally {
      Set.prototype.add = originalSetAdd;
    }
  });

  it('does not drag-snap when vertex and edge drag snapping are disabled', () => {
    const movingShape = [[0]];
    const targetShape = [[1]];
    const xx = new Float64Array([0, 0, 10, 20]);
    const yy = new Float64Array([0, 0, 0, 0]);
    const mapMock = {
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      getSource: vi.fn(() => ({
        getLayers: () => [
          { name: 'roads', geometry_type: 'polyline', shapes: [movingShape, targetShape] },
        ],
        getArcs: () => ({ getVertex2: () => [0, 0] }),
      })),
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    Reflect.set(
      mapshaper.internal as object,
      'forEachSegmentInShape',
      vi.fn((shape, _arcs, cb) => {
        if (shape === targetShape) cb(2, 3, xx, yy);
      }),
    );

    const handler = new VertexEditHandler(mapMock as any, {
      snapThreshold: 5,
      snapToVertex: false,
      snapToEdge: false,
    });
    setPrivate(handler, '_map', mapMock);
    setPrivate(handler, '_hoverVertexIds', [0]);
    setPrivate(handler, '_hoveredFeature', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: movingShape,
      arcs: { getVertex2: () => [0, 0] },
      geometryType: 'polyline',
      allLayers: [],
    });

    callPrivate(handler, '_handleDrag', 11, 0);

    expect(snapSpy).toHaveBeenCalledWith([0], [11, 0], expect.any(Object));
  });

  it('fires vertex_moved and avoids the full-bounds rebuild on finish drag', () => {
    const transformPoints = vi.fn();
    const fireSpy = vi.fn();
    const renderSpy = vi.fn();
    const refreshDisplayArcs = vi.fn();
    const markDisplayArcsDirty = vi.fn();

    const mapMock: MockMap = {
      getCanvasContainer: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      }),
      unproject: () => [123.45, 67.89],
      setEditVertexState: vi.fn(),
      render: renderSpy,
      fire: fireSpy,
      getSource: vi.fn(() => ({ refreshDisplayArcs, markDisplayArcsDirty })),
    };

    const handler = new VertexEditHandler(mapMock as any);
    setPrivate(handler, '_map', mapMock);
    setPrivate(handler, '_dragging', true);
    setPrivate(handler, '_hoverVertexIds', [8, 20]);
    setPrivate(handler, '_hoveredFeature', {
      id: 3,
      source: 'demo-source',
      layer: 'roads',
      shape: [[1]],
      arcs: {
        getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }),
        getVertex2: () => [0, 0],
        transformPoints,
      },
      geometryType: 'polyline',
    });

    // clientX:1, clientY:2, rect left:0, top:0 → px=1, py=2
    callPrivate(handler, '_finishDrag', 1, 2);

    expect(transformPoints).not.toHaveBeenCalled();
    expect(refreshDisplayArcs).toHaveBeenCalledTimes(1);
    expect(markDisplayArcsDirty).not.toHaveBeenCalled();
    expect(fireSpy).toHaveBeenCalledWith(
      'vertex_moved',
      expect.objectContaining({
        id: 3,
        source: 'demo-source',
        layer: 'roads',
        vertexIndex: 8,
        vertexIds: [8, 20],
        coords: [123.45, 67.89],
      }),
    );
    expect(renderSpy).toHaveBeenCalled();
  });

  it('enable() activates edit mode and isEnabled() returns true', () => {
    const setEditModeSpy = vi.fn();
    const onSpy = vi.fn();
    const mapMock = {
      setEditMode: setEditModeSpy,
      on: onSpy,
    };

    const handler = new VertexEditHandler(mapMock as any);
    handler.enable();

    expect(handler.isEnabled()).toBe(true);
    expect(setEditModeSpy).toHaveBeenCalledWith('vertex');
    expect(onSpy).toHaveBeenCalledWith('move', expect.any(Function));
    expect(handler.getCursor()).toBe('crosshair');
  });

  it('disable() deactivates edit mode, resets _dragging, and isEnabled() returns false', () => {
    const setEditModeSpy = vi.fn();
    const clearEditVertexState = vi.fn();
    const offSpy = vi.fn();
    const onSpy = vi.fn();
    const renderSpy = vi.fn();
    const mapMock = {
      setEditMode: setEditModeSpy,
      clearEditVertexState,
      on: onSpy,
      off: offSpy,
      render: renderSpy,
    };

    const handler = new VertexEditHandler(mapMock as any);
    handler.enable();
    setPrivate(handler, '_dragging', true);
    handler.disable();

    expect(handler.isEnabled()).toBe(false);
    expect(setEditModeSpy).toHaveBeenCalledWith('none');
    expect(clearEditVertexState).toHaveBeenCalled();
    expect(Reflect.get(handler, '_dragging')).toBe(false);
  });

  it('passes configured layers to hover hit-testing', () => {
    const queryFeatures = vi.fn(() => []);
    const mapMock = {
      queryFeatures,
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
    };

    const handler = new VertexEditHandler(mapMock as any);
    handler.setOptions({ layers: ['editable-roads'] });
    setPrivate(handler, '_enabled', true);

    handler.handlePointer({
      kind: 'move',
      point: { x: 12, y: 34 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: { type: 'move' } as unknown as Event,
    });

    expect(queryFeatures).toHaveBeenCalledWith([12, 34], { layers: ['editable-roads'] });
  });

  it('skips topology vertex lookup when the pointer is not near a shape vertex', () => {
    const findNearestSpy = vi.fn(() => [0]);
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', findNearestSpy);
    Reflect.set(mapshaper.internal as object, 'forEachSegmentInShape', vi.fn());
    const shape = [[0]];
    const arcs = {
      getArcIter: () =>
        makeArcIter([
          [0, 0],
          [100, 0],
        ]),
      getVertex2: () => [0, 0] as [number, number],
    };
    const mapMock = {
      queryFeatures: vi.fn(() => [
        { id: 0, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [{ name: 'roads', geometry_type: 'polyline', shapes: [shape] }],
        getArcs: () => arcs,
      })),
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      setEditVertexState: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
    };

    const handler = new VertexEditHandler(mapMock as any);
    setPrivate(handler, '_enabled', true);

    handler.handlePointer({
      kind: 'move',
      point: { x: 50, y: 50 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: { type: 'move' } as unknown as Event,
    });

    expect(findNearestSpy).not.toHaveBeenCalled();
  });

  it('keeps topology vertex lookup when the pointer is near a shape vertex', () => {
    const findNearestSpy = vi.fn(() => [0]);
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', findNearestSpy);
    Reflect.set(mapshaper.internal as object, 'forEachSegmentInShape', vi.fn());
    const shape = [[0]];
    const arcs = {
      getArcIter: () =>
        makeArcIter([
          [0, 0],
          [100, 0],
        ]),
      getVertex2: () => [0, 0] as [number, number],
    };
    const mapMock = {
      queryFeatures: vi.fn(() => [
        { id: 0, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [{ name: 'roads', geometry_type: 'polyline', shapes: [shape] }],
        getArcs: () => arcs,
      })),
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      setEditVertexState: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
    };

    const handler = new VertexEditHandler(mapMock as any);
    setPrivate(handler, '_enabled', true);

    handler.handlePointer({
      kind: 'move',
      point: { x: 3, y: 4 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: { type: 'move' } as unknown as Event,
    });

    expect(findNearestSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-render when the hover signature is unchanged', () => {
    const findNearestSpy = vi.fn(() => [0]);
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', findNearestSpy);
    Reflect.set(mapshaper.internal as object, 'forEachSegmentInShape', vi.fn());
    const shape = [[0]];
    const arcs = {
      getArcIter: () =>
        makeArcIter([
          [0, 0],
          [100, 0],
        ]),
      getVertex2: () => [0, 0] as [number, number],
    };
    const mapMock = {
      queryFeatures: vi.fn(() => [
        { id: 0, source: 'src-a', layer: 'roads', geometryType: 'polyline', properties: {} },
      ]),
      getSource: vi.fn(() => ({
        getLayers: () => [{ name: 'roads', geometry_type: 'polyline', shapes: [shape] }],
        getArcs: () => arcs,
      })),
      unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
      project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
      setEditVertexState: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
    };

    const handler = new VertexEditHandler(mapMock as any);
    setPrivate(handler, '_enabled', true);
    const event = {
      kind: 'move' as const,
      point: { x: 3, y: 4 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: { type: 'move' } as unknown as Event,
    };

    handler.handlePointer(event);
    handler.handlePointer(event);

    expect(mapMock.setEditVertexState).toHaveBeenCalledTimes(1);
    expect(mapMock.render).toHaveBeenCalledTimes(1);
  });
});

describe('VertexEditHandler context-menu CSS-token migration (DX P4)', () => {
  it('_showContextMenu sets class-based DOM and only dynamic position inline', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const mapMock = {
      setEditMode: () => {},
      on: () => {},
      off: () => {},
      render: () => {},
      clearEditVertexState: () => {},
    } as any;
    const handler = new VertexEditHandler(mapMock);
    Reflect.get(handler, '_showContextMenu').call(handler, 123, 456, () => {});

    const menu = document.getElementById('emap-ctx-menu') as HTMLDivElement;
    expect(menu).toBeTruthy();
    expect(menu.className).toBe('emap-ctx-menu');
    expect(menu.style.left).toBe('123px');
    expect(menu.style.top).toBe('456px');
    expect(menu.style.background).toBe('');
    expect(menu.style.boxShadow).toBe('');
    expect(menu.style.font).toBe('');

    const item = menu.firstElementChild as HTMLDivElement;
    expect(item).toBeTruthy();
    expect(item.className).toBe('emap-ctx-menu-item');
    expect(item.textContent).toBe('删除节点');
    item.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    expect(item.style.background).toBe('');

    menu.remove();
  });

  it('_showContextMenu click handler invokes onDelete and removes the menu', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const mapMock = {
      setEditMode: () => {},
      on: () => {},
      off: () => {},
      render: () => {},
      clearEditVertexState: () => {},
    } as any;
    const handler = new VertexEditHandler(mapMock);
    let called = 0;
    Reflect.get(handler, '_showContextMenu').call(handler, 10, 20, () => {
      called++;
    });
    const item = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;
    item.click();
    expect(called).toBe(1);
    expect(document.getElementById('emap-ctx-menu')).toBeNull();
  });
});
