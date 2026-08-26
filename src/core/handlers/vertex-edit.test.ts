// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { VertexEditHandler } from './vertex-edit';
import type { Emap } from '../../map/map';
import { EMAP_THEME_COLORS } from '../../theme/colors';
import type { NormalizedPointerEvent } from '../handler';

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

  it('uses the selection theme color for polygon fill by default', () => {
    const handler = new VertexEditHandler({} as any);

    expect(handler.getOptions().polygonFillColor).toBe(EMAP_THEME_COLORS.selection);
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

  it('moves only the detached feature vertices after splitting a shared node', () => {
    const splitSharedNode = vi.fn(() => [8, 9]);
    const mapMock = {
      editSession: { splitSharedNode },
      layers: {
        resolve: () => ({ geometry_type: 'polyline', shapes: [null, null, [[4, 2]]] }),
      },
      unproject: () => [3, 4] as [number, number],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap);
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    const hoveredFeature = {
      id: 2,
      source: 'src-a',
      layer: 'layer-a',
      shape: [[1]],
      arcs: {},
      geometryType: 'polyline',
      allLayers: [],
    };
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_hoverVertexCoords', [0, 0]);
    setPrivate(handler, '_hoverVertexIds', [4, 9]);
    setPrivate(handler, '_hoverType', 'vertex');

    callPrivate(handler, '_splitHoveredNode', hoveredFeature, 4);
    callPrivate(handler, '_handleDrag', 30, 40);

    expect(splitSharedNode).toHaveBeenCalledWith({ source: 'src-a', layer: 'layer-a', id: 2 }, 4);
    expect(snapSpy).toHaveBeenCalledWith([8, 9], [3, 4], expect.any(Object));
  });

  it('keeps the detached feature active when shared-node hit order changes', () => {
    const detachedShape = [[4, 2]];
    const neighborShape = [[1, 2]];
    const layer = {
      geometry_type: 'polyline',
      shapes: [null, neighborShape, detachedShape],
    };
    const arcs = {
      getVertexData: () => ({
        xx: new Float64Array(10),
        yy: new Float64Array(10),
        nn: new Int32Array([10]),
        ii: new Int32Array([0]),
      }),
    };
    const splitSharedNode = vi.fn(() => [8, 9]);
    const mapMock = {
      editSession: { splitSharedNode },
      layers: { resolve: () => layer },
      queryFeatures: vi.fn(() => [
        { id: 1, source: 'src-a', layer: 'layer-a', geometryType: 'polyline' },
        { id: 2, source: 'src-a', layer: 'layer-a', geometryType: 'polyline' },
      ]),
      getSource: () => ({
        getLayers: () => [layer],
        getArcs: () => arcs,
      }),
      unproject: (px: number, py: number) => [px / 10, py / 10] as [number, number],
      project: (x: number, y: number) => [x * 10, y * 10] as [number, number],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap);
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    const hoveredFeature = {
      id: 2,
      source: 'src-a',
      layer: 'layer-a',
      shape: detachedShape,
      arcs,
      geometryType: 'polyline',
      allLayers: [layer],
    };
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_hoverVertexCoords', [0, 0]);
    setPrivate(handler, '_hoverVertexIds', [4, 9]);
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_findNearestVertices', function (this: object) {
      const feature = Reflect.get(this, '_hoveredFeature') as { id: number };
      setPrivate(this, '_hoverVertexCoords', [0, 0]);
      setPrivate(this, '_hoverVertexIds', feature.id === 2 ? [8, 9] : [4, 8, 9]);
      setPrivate(this, '_hoverType', 'vertex');
    });
    setPrivate(handler, '_findNeighborShapes', vi.fn());

    callPrivate(handler, '_splitHoveredNode', hoveredFeature, 4);
    callPrivate(handler, '_onMouseMove', 0, 0);
    callPrivate(handler, '_handleDrag', 30, 40);

    expect(Reflect.get(handler, '_hoveredFeature').id).toBe(2);
    expect(snapSpy).toHaveBeenCalledWith([8, 9], [3, 4], expect.any(Object));
  });

  it('keeps a detached node active when the immediate hit test is empty', () => {
    const detachedShape = [[4, 2]];
    const layer = {
      geometry_type: 'polyline',
      shapes: [null, null, detachedShape],
    };
    const xx = new Float64Array(10);
    const yy = new Float64Array(10);
    const arcs = {
      getVertexData: () => ({ xx, yy, nn: new Int32Array([10]), ii: new Int32Array([0]) }),
    };
    const splitSharedNode = vi.fn(() => [8, 9]);
    const mapMock = {
      editSession: { splitSharedNode },
      layers: { resolve: () => layer },
      queryFeatures: vi.fn(() => []),
      getSource: () => ({
        getLayers: () => [layer],
        getArcs: () => arcs,
      }),
      project: (x: number, y: number) => [x, y] as [number, number],
      setEditVertexState: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap);
    const hoveredFeature = {
      id: 2,
      source: 'src-a',
      layer: 'layer-a',
      shape: detachedShape,
      arcs,
      geometryType: 'polyline',
      allLayers: [layer],
    };
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_hoverVertexCoords', [0, 0]);
    setPrivate(handler, '_hoverVertexIds', [4, 9]);
    setPrivate(handler, '_hoverType', 'vertex');

    callPrivate(handler, '_splitHoveredNode', hoveredFeature, 4);
    callPrivate(handler, '_onMouseMove', 0, 0);

    expect(Reflect.get(handler, '_hoveredFeature').id).toBe(2);
    expect(Reflect.get(handler, '_hoverVertexIds')).toEqual([8, 9]);
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

  it('adopts all coincident vertex ids after completing a vertex snap', () => {
    const movingShape = [[0]];
    const findNearestSpy = vi.fn(() => [0, 2]);
    const snapSpy = vi.fn();
    const refreshDisplayArcs = vi.fn();
    const fireSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', findNearestSpy);
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
    const mapMock = {
      unproject: () => [10, 0] as [number, number],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: fireSpy,
      getSource: () => ({ refreshDisplayArcs }),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap, {
      snapToVertex: false,
      snapToEdge: false,
    });
    setPrivate(handler, '_dragging', true);
    setPrivate(handler, '_hoverVertexIds', [0]);
    setPrivate(handler, '_hoveredFeature', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: movingShape,
      arcs: {},
      geometryType: 'polyline',
      allLayers: [],
    });

    callPrivate(handler, '_finishDrag', 10, 0);
    callPrivate(handler, '_handleDrag', 12, 0);

    expect(findNearestSpy).toHaveBeenCalledWith([10, 0], movingShape, expect.any(Object));
    expect(snapSpy).toHaveBeenLastCalledWith([0, 2], [10, 0], expect.any(Object));
    expect(fireSpy).toHaveBeenCalledWith(
      'vertex_moved',
      expect.objectContaining({ vertexIds: [0, 2] }),
    );
  });

  it('clears detached state when the node is snapped onto another feature vertex', () => {
    const movingShape = [[0]];
    const targetShape = [[1]];
    const xx = new Float64Array([0, -1, 10, 11]);
    const yy = new Float64Array([0, 0, 0, 0]);
    const arcs = {
      size: () => 2,
      getVertexData: () => ({
        xx,
        yy,
        nn: new Int32Array([2, 2]),
        ii: new Int32Array([0, 2]),
      }),
    };
    const layer = {
      geometry_type: 'polyline',
      shapes: [movingShape, targetShape],
    };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
      refreshDisplayArcs: vi.fn(),
    };
    Reflect.set(
      mapshaper.internal as object,
      'findNearestVertices',
      vi.fn(() => [0, 2]),
    );
    Reflect.set(
      mapshaper.internal as object,
      'snapVerticesToPoint',
      vi.fn((vertexIds: number[], to: [number, number]) => {
        for (const vertexId of vertexIds) {
          xx[vertexId] = to[0];
          yy[vertexId] = to[1];
        }
      }),
    );
    const mapMock = {
      unproject: () => [10, 0] as [number, number],
      getSource: () => source,
      layers: { resolve: () => layer },
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap, {
      snapToVertex: false,
      snapToEdge: false,
    });
    setPrivate(handler, '_dragging', true);
    setPrivate(handler, '_hoverVertexCoords', [0, 0]);
    setPrivate(handler, '_hoverVertexIds', [0]);
    setPrivate(handler, '_hoveredFeature', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: movingShape,
      arcs,
      geometryType: 'polyline',
      allLayers: [layer],
    });
    setPrivate(handler, '_detachedNode', {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      coords: [0, 0],
      vertexIds: [0],
    });

    callPrivate(handler, '_finishDrag', 10, 0);

    expect(Reflect.get(handler, '_hoverVertexIds')).toEqual([0, 2]);
    expect(Reflect.get(handler, '_detachedNode')).toBeNull();
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

  it('clears detached hover state when edit history changes', () => {
    const listeners = new Map<string, (state: { canRedo: boolean }) => void>();
    const mapMock = {
      setEditMode: vi.fn(),
      on: vi.fn((type: string, listener: (state: { canRedo: boolean }) => void) => {
        listeners.set(type, listener);
      }),
      off: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap);
    handler.enable();
    setPrivate(handler, '_hoveredFeature', { id: 0 });
    setPrivate(handler, '_hoverVertexCoords', [1, 2]);
    setPrivate(handler, '_hoverVertexIds', [8, 9]);
    setPrivate(handler, '_detachedNode', { id: 0 });

    const historyListener = listeners.get('historychange');
    if (!historyListener) throw new Error('historychange listener was not registered');
    historyListener({ canRedo: true });

    expect(Reflect.get(handler, '_hoveredFeature')).toBeNull();
    expect(Reflect.get(handler, '_hoverVertexIds')).toEqual([]);
    expect(Reflect.get(handler, '_detachedNode')).toBeNull();
    expect(mapMock.clearEditVertexState).toHaveBeenCalledTimes(1);
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
      layers: {
        resolve: () => ({ name: 'roads', geometry_type: 'polyline', shapes: [shape] }),
      },
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
      layers: {
        resolve: () => ({ name: 'roads', geometry_type: 'polyline', shapes: [shape] }),
      },
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
      layers: {
        resolve: () => ({ name: 'roads', geometry_type: 'polyline', shapes: [shape] }),
      },
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
  it('allows deleting a non-shared arc endpoint', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const originalVertexIsArcEndpoint = Reflect.get(
      mapshaper.internal as object,
      'vertexIsArcEndpoint',
    );
    Reflect.set(
      mapshaper.internal as object,
      'vertexIsArcEndpoint',
      vi.fn(() => true),
    );
    const handler = new VertexEditHandler({} as any);
    const deleteSpy = vi.fn();
    const hoveredFeature = { arcs: {} };
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_hoverVertexIds', [4]);
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_deleteHoveredVertex', deleteSpy);

    try {
      callPrivate(
        handler,
        '_onContextMenu',
        new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
      );
      const item = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;
      expect(item.textContent).toBe('删除节点');
      expect(item.getAttribute('aria-disabled')).toBeNull();
      setPrivate(handler, '_hoverVertexIds', []);
      setPrivate(handler, '_hoveredFeature', null);
      item.click();
      expect(deleteSpy).toHaveBeenCalledWith(hoveredFeature, [4]);
    } finally {
      Reflect.set(mapshaper.internal as object, 'vertexIsArcEndpoint', originalVertexIsArcEndpoint);
      document.getElementById('emap-ctx-menu')?.remove();
    }
  });

  it('allows deleting a shared topology node and keeps split available', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0]], [[0]]],
    };
    const arcs = {
      size: () => 1,
      getVertexData: () => ({
        xx: new Float64Array([0, 1]),
        yy: new Float64Array([0, 0]),
        nn: new Int32Array([2]),
        ii: new Int32Array([0]),
      }),
    };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
    };
    const handler = new VertexEditHandler({
      getSource: () => source,
      layers: { resolve: () => layer },
    } as unknown as Emap);
    const deleteSpy = vi.fn();
    const splitSpy = vi.fn();
    const hoveredFeature = {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: layer.shapes[0],
      arcs,
    };
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_hoverVertexCoords', [1, 0]);
    setPrivate(handler, '_hoverVertexIds', [1]);
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_deleteHoveredVertex', deleteSpy);
    setPrivate(handler, '_splitHoveredNode', splitSpy);

    callPrivate(
      handler,
      '_onContextMenu',
      new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
    );
    const items = document.querySelectorAll<HTMLDivElement>('#emap-ctx-menu > div');
    expect(items).toHaveLength(2);
    items[0].click();
    expect(deleteSpy).toHaveBeenCalledWith(hoveredFeature, [1]);
    expect(items[1].textContent).toBe('分离共享节点');
    items[1].click();
    expect(splitSpy).toHaveBeenCalledWith(hoveredFeature, 1, [1, 0]);
    document.getElementById('emap-ctx-menu')?.remove();
  });

  it('uses a vertex owned by the hovered feature when classifying and splitting', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const targetShape = [[1]];
    const layer = {
      geometry_type: 'polyline',
      shapes: [targetShape, [[0]]],
    };
    const arcs = {
      size: () => 2,
      getVertexData: () => ({
        xx: new Float64Array([0, -1, 0, 1]),
        yy: new Float64Array([0, 0, 0, 0]),
        nn: new Int32Array([2, 2]),
        ii: new Int32Array([0, 2]),
      }),
    };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
    };
    const handler = new VertexEditHandler({
      getSource: () => source,
      layers: { resolve: () => layer },
    } as unknown as Emap);
    const splitSpy = vi.fn();
    const hoveredFeature = {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: targetShape,
      arcs,
      geometryType: 'polyline',
      allLayers: [layer],
    };
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_hoverVertexCoords', [0, 0]);
    setPrivate(handler, '_hoverVertexIds', [0, 2]);
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_splitHoveredNode', splitSpy);

    callPrivate(
      handler,
      '_onContextMenu',
      new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
    );
    const items = document.querySelectorAll<HTMLDivElement>('#emap-ctx-menu > div');
    expect(items).toHaveLength(2);
    items[1].click();
    expect(splitSpy).toHaveBeenCalledWith(hoveredFeature, 2, [0, 0]);
    document.getElementById('emap-ctx-menu')?.remove();
  });

  it('restores the split node after pointer movement clears hover while the menu is open', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const shape = [[0]];
    const layer = {
      geometry_type: 'polyline',
      shapes: [shape, [[0]]],
    };
    const arcs = {
      size: () => 1,
      getVertexData: () => ({
        xx: new Float64Array([0, 1]),
        yy: new Float64Array([0, 0]),
        nn: new Int32Array([2]),
        ii: new Int32Array([0]),
      }),
    };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
    };
    const splitSharedNode = vi.fn(() => [1]);
    const mapMock = {
      editSession: { splitSharedNode },
      getSource: () => source,
      layers: { resolve: () => layer },
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const handler = new VertexEditHandler(mapMock as unknown as Emap);
    const hoveredFeature = {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape,
      arcs,
      geometryType: 'polyline',
      allLayers: [layer],
    };
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_hoverVertexCoords', [1, 0]);
    setPrivate(handler, '_hoverVertexIds', [1]);
    setPrivate(handler, '_hoveredFeature', hoveredFeature);

    callPrivate(
      handler,
      '_onContextMenu',
      new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
    );
    setPrivate(handler, '_hoveredFeature', null);
    setPrivate(handler, '_hoverVertexCoords', null);
    setPrivate(handler, '_hoverVertexIds', []);
    setPrivate(handler, '_hoverType', null);
    const items = document.querySelectorAll<HTMLDivElement>('#emap-ctx-menu > div');
    items[1].click();

    expect(splitSharedNode).toHaveBeenCalledWith({ source: 'src-a', layer: 'roads', id: 0 }, 1);
    expect(Reflect.get(handler, '_hoveredFeature')).toBe(hoveredFeature);
    expect(Reflect.get(handler, '_hoverVertexCoords')).toEqual([1, 0]);
    expect(Reflect.get(handler, '_hoverVertexIds')).toEqual([1]);
    expect(Reflect.get(handler, '_detachedNode')).toEqual({
      id: 0,
      source: 'src-a',
      layer: 'roads',
      coords: [1, 0],
      vertexIds: [1],
    });
    document.getElementById('emap-ctx-menu')?.remove();
  });

  it('does not classify repeated nodes inside one feature as shared', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const layer = {
      geometry_type: 'polyline',
      shapes: [[[0, 1]]],
    };
    const arcs = {
      size: () => 2,
      getVertexData: () => ({
        xx: new Float64Array([0, 1, 1, 2]),
        yy: new Float64Array([0, 0, 0, 0]),
        nn: new Int32Array([2, 2]),
        ii: new Int32Array([0, 2]),
      }),
    };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
    };
    const handler = new VertexEditHandler({
      getSource: () => source,
      layers: { resolve: () => layer },
    } as unknown as Emap);
    const deleteSpy = vi.fn();
    const splitSpy = vi.fn();
    const hoveredFeature = {
      id: 0,
      source: 'src-a',
      layer: 'roads',
      shape: layer.shapes[0],
      arcs,
    };
    setPrivate(handler, '_hoverType', 'vertex');
    setPrivate(handler, '_hoverVertexIds', [1, 2]);
    setPrivate(handler, '_hoveredFeature', hoveredFeature);
    setPrivate(handler, '_deleteHoveredVertex', deleteSpy);
    setPrivate(handler, '_splitHoveredNode', splitSpy);

    callPrivate(
      handler,
      '_onContextMenu',
      new MouseEvent('contextmenu', { clientX: 10, clientY: 20 }),
    );
    const items = document.querySelectorAll<HTMLDivElement>('#emap-ctx-menu > div');
    expect(items).toHaveLength(1);
    items[0].click();
    expect(deleteSpy).toHaveBeenCalledWith(hoveredFeature, [1, 2]);
    expect(splitSpy).not.toHaveBeenCalled();
    document.getElementById('emap-ctx-menu')?.remove();
  });

  it('_showContextMenu sets class-based DOM and only dynamic position inline', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const themeHost = document.createElement('div');
    themeHost.style.setProperty('--emap-surface-bg', 'rgb(10, 20, 30)');
    themeHost.style.setProperty('--emap-danger', 'rgb(40, 50, 60)');
    document.body.append(themeHost);
    const mapMock = {
      setEditMode: () => {},
      on: () => {},
      off: () => {},
      render: () => {},
      clearEditVertexState: () => {},
      getCanvasContainer: () => themeHost,
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
    expect(menu.getAttribute('role')).toBe('menu');
    expect(menu.style.getPropertyValue('--emap-surface-bg')).toBe('rgb(10, 20, 30)');
    expect(menu.style.getPropertyValue('--emap-danger')).toBe('rgb(40, 50, 60)');

    const item = menu.firstElementChild as HTMLDivElement;
    expect(item).toBeTruthy();
    expect(item.className).toBe('emap-ctx-menu-item');
    expect(item.textContent).toBe('删除节点');
    expect(item.getAttribute('role')).toBe('menuitem');
    expect(item.tabIndex).toBe(0);
    item.dispatchEvent(new Event('mouseenter', { bubbles: true }));
    expect(item.style.background).toBe('');

    menu.remove();
    themeHost.remove();
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

  it('_showContextMenu supports keyboard activation and skips disabled items', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const handler = new VertexEditHandler({} as any);
    const onDelete = vi.fn();
    Reflect.get(handler, '_showContextMenu').call(handler, 10, 20, onDelete);
    const enabled = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;

    enabled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(document.getElementById('emap-ctx-menu')).toBeNull();

    Reflect.get(handler, '_showContextMenu').call(handler, 10, 20, null);
    const disabled = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;
    expect(disabled.getAttribute('role')).toBe('menuitem');
    expect(disabled.tabIndex).toBe(-1);
    document.getElementById('emap-ctx-menu')?.remove();
  });

describe('VertexEditHandler batch vertex selection', () => {
  function pointer(
    kind: NormalizedPointerEvent['kind'],
    x: number,
    y: number,
  ): NormalizedPointerEvent {
    return {
      kind,
      point: { x, y },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new Event(kind),
    };
  }

  it('publishes the rubber-band rectangle while selecting from empty space', () => {
    const setEditVertexState = vi.fn();
    const map = {
      setEditVertexState,
      render: vi.fn(),
    };
    const handler = new VertexEditHandler(map as unknown as Emap);
    setPrivate(handler, '_enabled', true);

    expect(handler.handlePointer(pointer('down', 10, 20))).toBe('exclusive');
    expect(handler.handlePointer(pointer('move', 30, 50))).toBe('exclusive');
    expect(setEditVertexState).toHaveBeenLastCalledWith(
      expect.objectContaining({ band: { x0: 10, y0: 20, x1: 30, y1: 50 } }),
    );
  });
  it('deletes two selected nodes in one source atomically and undo restores both', () => {
    let nn = Int32Array.from([3, 3]);
    let xx = Float64Array.from([0, 1, 2, 3, 4, 5]);
    let yy = Float64Array.from([0, 0, 0, 0, 0, 0]);
    let ii = Int32Array.from([0, 3]);
    const arcs = {
      size: () => nn.length,
      getVertexData: () => ({ nn, xx, yy, ii, zz: null }),
      updateVertexData: (nextNn: Int32Array, nextXx: Float64Array, nextYy: Float64Array) => {
        nn = nextNn;
        xx = nextXx;
        yy = nextYy;
        ii = Int32Array.from([0, nextNn[0]]);
      },
    };
    const layer = { geometry_type: 'polyline', shapes: [[[0]], [[1]]] };
    const source = {
      getArcs: () => arcs,
      getLayers: () => [layer],
      getDataset: () => ({ arcs, layers: [layer], info: {}, editVersion: 0 }),
      refreshDisplayArcs: vi.fn(),
    };
    const pushed: Array<{ undo(): void }> = [];
    const map = {
      getSource: () => source,
      pushCommand: (command: { undo(): void }) => pushed.push(command),
      setEditVertexState: vi.fn(),
      clearEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn(),
    };
    const handler = new VertexEditHandler(map as unknown as Emap);
    setPrivate(handler, '_selectedNodes', [
      { source: 'source', layer: 'layer', vertexIds: [1], coords: [1, 0] },
      { source: 'source', layer: 'layer', vertexIds: [4], coords: [4, 0] },
    ]);

    callPrivate(handler, '_onKeyDown', new KeyboardEvent('keydown', { key: 'Delete' }));

    expect(Array.from(xx)).toEqual([0, 2, 3, 5]);
    expect(pushed).toHaveLength(1);
    pushed[0].undo();
    expect(Array.from(xx)).toEqual([0, 1, 2, 3, 4, 5]);
  });
  it('selects enclosed nodes and adds to that set with Shift', () => {
    const arcs = {
      getArcIter: (arcId: number) =>
        makeArcIter(arcId === 0 ? [[1, 1]] : [[5, 5]]),
      getVertexData: () => ({
        xx: Float64Array.from([1, 5]),
        yy: Float64Array.from([1, 5]),
        nn: Int32Array.from([1, 1]),
        ii: Int32Array.from([0, 1]),
      }),
    };
    const layer = { geometry_type: 'polyline', shapes: [[[0]], [[1]]] };
    const queryFeatures = vi.fn(() => [
      { id: 0, source: 'source', layer: 'layer', geometryType: 'polyline' },
    ]);
    const map = {
      queryFeatures,
      getSource: () => ({ getArcs: () => arcs }),
      layers: { resolve: () => layer },
      project: (x: number, y: number) => [x, y] as [number, number],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    Reflect.set(
      mapshaper.internal as object,
      'findNearestVertices',
      vi.fn((coord: [number, number]) => (coord[0] === 1 ? [0] : [1])),
    );
    const handler = new VertexEditHandler(map as unknown as Emap);
    setPrivate(handler, '_bandStart', { x: 0, y: 0 });
    setPrivate(handler, '_bandAdditive', false);
    callPrivate(handler, '_finishBand', 3, 3);
    expect(Reflect.get(handler, '_selectedNodes')).toEqual([
      { source: 'source', layer: 'layer', vertexIds: [0], coords: [1, 1] },
    ]);

    queryFeatures.mockReturnValue([
      { id: 1, source: 'source', layer: 'layer', geometryType: 'polyline' },
    ]);
    setPrivate(handler, '_bandStart', { x: 3, y: 3 });
    setPrivate(handler, '_bandAdditive', true);
    callPrivate(handler, '_finishBand', 7, 7);
    expect(Reflect.get(handler, '_selectedNodes')).toEqual([
      { source: 'source', layer: 'layer', vertexIds: [0], coords: [1, 1] },
      { source: 'source', layer: 'layer', vertexIds: [1], coords: [5, 5] },
    ]);
  });
  it('moves a selected shared node once and records one batch history entry', () => {
    const arcs = {};
    const source = { getArcs: () => arcs, refreshDisplayArcs: vi.fn(), getDataset: () => ({}) };
    const pushCommand = vi.fn();
    const map = {
      unproject: (x: number, y: number) => [x, y] as [number, number],
      getSource: () => source,
      pushCommand,
      setEditVertexState: vi.fn(),
      render: vi.fn(),
    };
    const snapVertices = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapVertices);
    const handler = new VertexEditHandler(map as unknown as Emap);
    setPrivate(handler, '_selectedNodes', [
      { source: 'source', layer: 'layer', vertexIds: [1, 4], coords: [1, 1] },
    ]);
    setPrivate(handler, '_batchDragging', true);
    setPrivate(handler, '_dragging', true);
    setPrivate(handler, '_batchDragFrom', [1, 1]);

    callPrivate(handler, '_handleDrag', 3, 4);
    callPrivate(handler, '_finishDrag', 3, 4);

    expect(snapVertices).toHaveBeenCalledTimes(1);
    expect(snapVertices).toHaveBeenCalledWith([1, 4], [3, 4], arcs);
    expect(pushCommand).toHaveBeenCalledOnce();
  });
  it('clears the selected node set on Escape', () => {
    const map = {
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      getSource: vi.fn(),
    };
    const handler = new VertexEditHandler(map as unknown as Emap);
    setPrivate(handler, '_selectedNodes', [
      { source: 'source', layer: 'layer', vertexIds: [1], coords: [1, 0] },
    ]);

    callPrivate(handler, '_onKeyDown', new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(Reflect.get(handler, '_selectedNodes')).toEqual([]);
    expect(map.render).toHaveBeenCalledOnce();
  });
});
});
