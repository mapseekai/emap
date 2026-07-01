import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DrawFeatureHandler, projectPointOnSegment } from './draw-feature';

function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

function getPrivate(target: object, key: string): unknown {
  return Reflect.get(target, key);
}

function callPrivate(target: object, key: string, ...args: unknown[]): unknown {
  const fn = Reflect.get(target, key);
  if (typeof fn !== 'function') {
    throw new Error(`Expected ${key} to be a function`);
  }
  return (fn as (...input: unknown[]) => unknown).apply(target, args);
}

function createMockMap(sources?: Record<string, unknown>) {
  const sourceMap = new Map(Object.entries(sources || {}));
  return {
    getCanvasContainer: () => ({
      getBoundingClientRect: () => ({ left: 0, top: 0 }),
      classList: { add: vi.fn(), remove: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
    unproject: vi.fn((px: number, py: number) => [px, py] as [number, number]),
    project: vi.fn((x: number, y: number) => [x, y] as [number, number]),
    setEditMode: vi.fn(),
    setEditDrawState: vi.fn(),
    clearEditDrawState: vi.fn(),
    render: vi.fn(),
    fire: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    getSource: vi.fn((id: string) => sourceMap.get(id)),
    pushCommand: vi.fn(),
  };
}

function createMockSource(options?: {
  layers?: unknown[];
  vertexData?: {
    xx: Float64Array;
    yy: Float64Array;
    nn: Int32Array;
    ii: Int32Array;
    zz: null;
    bb: Float64Array;
  };
}) {
  const updateVertexData = vi.fn();
  return {
    id: 'test-source',
    type: 'topology' as const,
    on: vi.fn(),
    off: vi.fn(),
    fire: vi.fn(),
    getArcs: vi.fn(() => ({
      getVertexData: () =>
        options?.vertexData || {
          xx: new Float64Array([0, 10, 20]),
          yy: new Float64Array([0, 10, 20]),
          nn: new Int32Array([3]),
          ii: new Int32Array([0]),
          zz: null,
          bb: new Float64Array([0, 0, 20, 20]),
        },
      updateVertexData,
      size: () => options?.vertexData?.nn.length || 1,
      transformPoints: vi.fn(),
    })),
    getLayers: vi.fn(
      () =>
        options?.layers || [
          {
            name: 'test-layer',
            geometry_type: 'polygon',
            shapes: [],
            data: { getRecords: () => [] },
          },
        ],
    ),
    getDataset: vi.fn(() => ({
      layers: options?.layers || [
        {
          name: 'test-layer',
          geometry_type: 'polygon',
          shapes: [],
          data: { getRecords: () => [] },
        },
      ],
      arcs: {
        getVertexData: () =>
          options?.vertexData || {
            xx: new Float64Array([0, 10, 20]),
            yy: new Float64Array([0, 10, 20]),
            nn: new Int32Array([3]),
            ii: new Int32Array([0]),
            zz: null,
            bb: new Float64Array([0, 0, 20, 20]),
          },
        updateVertexData,
        size: () => 1,
        transformPoints: vi.fn(),
      },
    })),
    getDisplayArcs: vi.fn(() => null),
    getExtent: vi.fn(),
    refreshDisplayArcs: vi.fn(),
  };
}

describe('DrawFeatureHandler', () => {
  describe('vertex placement', () => {
    it('adds a vertex on click for polygon mode', () => {
      const source = createMockSource();
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);

      // Simulate click with element-local coords (clientX=100, clientY=200 with rect {left:0,top:0})
      callPrivate(handler, '_onClick', 100, 200);

      const vertices = getPrivate(handler, '_vertices') as [number, number][];
      expect(vertices).toHaveLength(1);
      expect(vertices[0]).toEqual([100, 200]);
    });

    it('places a point immediately on click in point mode', () => {
      const layer = {
        name: 'points',
        geometry_type: 'point',
        shapes: [] as unknown[],
        data: { getRecords: () => [] as Record<string, unknown>[] },
      };
      const source = createMockSource({ layers: [layer] });
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'point' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);

      // element-local coords from clientX=50, clientY=60 with rect {left:0,top:0}
      callPrivate(handler, '_onClick', 50, 60);

      // Should have fired feature_created
      expect(map.fire).toHaveBeenCalledWith(
        'feature_created',
        expect.objectContaining({
          geometryType: 'point',
          source: 'src1',
        }),
      );
    });
  });

  describe('snap detection', () => {
    it('returns snap coord when cursor is within threshold', () => {
      const source = createMockSource({
        vertexData: {
          xx: new Float64Array([100, 200]),
          yy: new Float64Array([100, 200]),
          nn: new Int32Array([2]),
          ii: new Int32Array([0]),
          zz: null,
          bb: new Float64Array([100, 100, 200, 200]),
        },
      });
      const map = createMockMap({ src1: source });
      // project returns identity
      map.project.mockImplementation((x: number, y: number) => [x, y]);

      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polygon',
        snapThreshold: 15,
      });
      setPrivate(handler, '_map', map);

      // Cursor at (105, 105) — within 15px of (100, 100)
      const snap = callPrivate(handler, '_findSnapTarget', 105, 105) as {
        coord: [number, number];
        kind: 'vertex' | 'edge' | null;
      } | null;
      expect(snap).not.toBeNull();
      expect(snap!.coord[0]).toBe(100);
      expect(snap!.coord[1]).toBe(100);
      expect(snap!.kind).toBe('vertex');
    });

    it('returns null when cursor is outside threshold', () => {
      const source = createMockSource({
        vertexData: {
          xx: new Float64Array([100]),
          yy: new Float64Array([100]),
          nn: new Int32Array([1]),
          ii: new Int32Array([0]),
          zz: null,
          bb: new Float64Array([100, 100, 100, 100]),
        },
      });
      const map = createMockMap({ src1: source });
      map.project.mockImplementation((x: number, y: number) => [x, y]);

      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polygon',
        snapThreshold: 5,
      });
      setPrivate(handler, '_map', map);

      const snap = callPrivate(handler, '_findSnapTarget', 120, 120) as [number, number] | null;
      expect(snap).toBeNull();
    });

    it('clears the snap overlay when the cursor leaves threshold before the first vertex', () => {
      const source = createMockSource({
        vertexData: {
          xx: new Float64Array([100]),
          yy: new Float64Array([100]),
          nn: new Int32Array([1]),
          ii: new Int32Array([0]),
          zz: null,
          bb: new Float64Array([100, 100, 100, 100]),
        },
      });
      const map = createMockMap({ src1: source });
      map.project.mockImplementation((x: number, y: number) => [x, y]);

      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polygon',
        snapThreshold: 15,
      });
      setPrivate(handler, '_map', map);

      callPrivate(handler, '_onMouseMove', 105, 105);
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cursorCoord: [100, 100],
          snapCoord: [100, 100],
          snapKind: 'vertex',
        }),
      );

      map.setEditDrawState.mockClear();
      map.render.mockClear();

      callPrivate(handler, '_onMouseMove', 140, 140);

      expect(map.setEditDrawState).toHaveBeenCalledTimes(1);
      expect(map.setEditDrawState).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cursorCoord: [140, 140],
          snapCoord: null,
          snapKind: null,
        }),
      );
      expect(map.render).toHaveBeenCalledTimes(1);
    });

    // -----------------------------------------------------------------------
    // Edge snap — perpendicular projection onto segments
    // -----------------------------------------------------------------------

    function makeSourceWithSegment(from: [number, number], to: [number, number]): any {
      const xx = new Float64Array([from[0], to[0]]);
      const yy = new Float64Array([from[1], to[1]]);
      return {
        id: 'seg',
        type: 'topology' as const,
        on: vi.fn(),
        off: vi.fn(),
        fire: vi.fn(),
        getArcs: vi.fn(() => ({
          getVertexData: () => ({
            xx,
            yy,
            nn: new Int32Array([2]),
            ii: new Int32Array([0]),
            zz: null,
            bb: new Float64Array([from[0], from[1], to[0], to[1]]),
          }),
          // One segment — call the callback once with vertex indices 0,1.
          forEachSegment: (
            cb: (i: number, j: number, xx2: Float64Array, yy2: Float64Array) => void,
          ) => {
            cb(0, 1, xx, yy);
          },
          size: () => 1,
        })),
        getLayers: vi.fn(() => []),
        getDataset: vi.fn(() => ({ layers: [] })),
      };
    }

    it('edge snap: cursor near segment midpoint snaps to segment with kind="edge"', () => {
      // Segment from (0,0) to (100, 0). Cursor at (50, 3) — perpendicular
      // distance 3, projection at (50, 0) which is on the segment.
      const map = createMockMap({ src1: makeSourceWithSegment([0, 0], [100, 0]) });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 50, 3) as {
        coord: [number, number];
        kind: 'vertex' | 'edge' | null;
      } | null;
      expect(snap).not.toBeNull();
      expect(snap!.kind).toBe('edge');
      expect(snap!.coord[0]).toBe(50);
      expect(snap!.coord[1]).toBe(0);
    });

    it('edge snap: cursor past segment endpoint does NOT snap to segment', () => {
      // Segment (0,0)-(100,0). Cursor at (150, 3) — projection past t=1.
      // Threshold 5 means even endpoint at (100,0) isn't reachable.
      const map = createMockMap({ src1: makeSourceWithSegment([0, 0], [100, 0]) });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 5,
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 150, 3);
      expect(snap).toBeNull();
    });

    it('vertex preferred over edge at equal distance', () => {
      // Same segment (0,0)-(100,0); cursor exactly on vertex (0,0).
      // Vertex distance is 0; edge distance is also 0 at t=0. Vertex
      // should win the tie because the vertex loop runs first and uses
      // strict `<` for replacement.
      const map = createMockMap({ src1: makeSourceWithSegment([0, 0], [100, 0]) });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 0, 0) as {
        coord: [number, number];
        kind: 'vertex' | 'edge' | null;
      } | null;
      expect(snap).not.toBeNull();
      expect(snap!.kind).toBe('vertex');
      expect(snap!.coord).toEqual([0, 0]);
    });

    it('snapToEdge: false disables edge snap (vertex still works)', () => {
      // Cursor near midpoint with edge disabled — should fall through to
      // null because vertices at (0,0) and (100,0) are both far from (50,3).
      const map = createMockMap({ src1: makeSourceWithSegment([0, 0], [100, 0]) });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
        snapToEdge: false,
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 50, 3);
      expect(snap).toBeNull();
    });

    it('snapToVertex: false disables vertex snap (edge still works)', () => {
      // Cursor near vertex (0,0) but with vertex disabled. Edge snap should
      // still find t=0 on the segment (degenerate case but valid).
      const map = createMockMap({ src1: makeSourceWithSegment([0, 0], [100, 0]) });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
        snapToVertex: false,
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 1, 1) as {
        coord: [number, number];
        kind: 'vertex' | 'edge' | null;
      } | null;
      expect(snap).not.toBeNull();
      expect(snap!.kind).toBe('edge');
    });

    it('snapSources iterates multiple sources', () => {
      // src1 has a segment far away; src2 has a segment near the cursor.
      const map = createMockMap({
        src1: makeSourceWithSegment([1000, 1000], [1100, 1000]),
        src2: makeSourceWithSegment([0, 0], [100, 0]),
      });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
        snapSources: ['src1', 'src2'],
      });
      setPrivate(handler, '_map', map);
      const snap = callPrivate(handler, '_findSnapTarget', 50, 3) as {
        coord: [number, number];
        kind: 'vertex' | 'edge' | null;
      } | null;
      expect(snap).not.toBeNull();
      expect(snap!.coord).toEqual([50, 0]); // src2's segment
    });

    it('snapSources with unknown source IDs is a silent skip', () => {
      const map = createMockMap({
        src1: makeSourceWithSegment([0, 0], [100, 0]),
      });
      map.project.mockImplementation((x: number, y: number) => [x, y]);
      const handler = new DrawFeatureHandler(map as any, {
        source: 'src1',
        type: 'polyline',
        snapThreshold: 10,
        snapSources: ['src1', 'nonexistent', 'also-missing'],
      });
      setPrivate(handler, '_map', map);
      // Should still find src1's segment without throwing.
      const snap = callPrivate(handler, '_findSnapTarget', 50, 3) as any;
      expect(snap).not.toBeNull();
      expect(snap.kind).toBe('edge');
    });
  });

  describe('projectPointOnSegment', () => {
    it('perpendicular projection inside segment', () => {
      const r = projectPointOnSegment([5, 3], [0, 0], [10, 0]);
      expect(r.point).toEqual([5, 0]);
      expect(r.dist).toBe(3);
    });

    it('cursor before segment start clamps to start endpoint', () => {
      const r = projectPointOnSegment([-5, 4], [0, 0], [10, 0]);
      expect(r.point).toEqual([0, 0]);
      expect(r.dist).toBe(Math.hypot(-5, 4));
    });

    it('cursor past segment end clamps to end endpoint', () => {
      const r = projectPointOnSegment([15, 4], [0, 0], [10, 0]);
      expect(r.point).toEqual([10, 0]);
      expect(r.dist).toBe(Math.hypot(5, 4));
    });

    it('zero-length segment returns the endpoint with distance to it', () => {
      const r = projectPointOnSegment([3, 4], [0, 0], [0, 0]);
      expect(r.point).toEqual([0, 0]);
      expect(r.dist).toBe(5);
    });

    it('diagonal segment: perpendicular projection works', () => {
      // Segment from (0,0) to (10,10). Cursor at (5, 0) — projection lies
      // on segment at (2.5, 2.5) with perpendicular distance √(2.5² + 2.5²).
      const r = projectPointOnSegment([5, 0], [0, 0], [10, 10]);
      expect(r.point[0]).toBeCloseTo(2.5);
      expect(r.point[1]).toBeCloseTo(2.5);
      expect(r.dist).toBeCloseTo(Math.hypot(2.5, 2.5));
    });
  });

  describe('polygon completion via dblclick', () => {
    it('commits polygon with 3+ vertices on dblclick', () => {
      const layer = {
        name: 'polygons',
        geometry_type: 'polygon',
        shapes: [] as unknown[],
        data: { getRecords: () => [] as Record<string, unknown>[] },
      };
      const source = createMockSource({ layers: [layer] });
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);
      setPrivate(handler, '_vertices', [
        [0, 0] as [number, number],
        [10, 0] as [number, number],
        [10, 10] as [number, number],
      ]);

      callPrivate(handler, '_onDblClick', {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent);

      expect(map.fire).toHaveBeenCalledWith(
        'feature_created',
        expect.objectContaining({
          geometryType: 'polygon',
          source: 'src1',
        }),
      );
    });

    it('does not commit polygon with fewer than 3 vertices', () => {
      const source = createMockSource();
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);
      setPrivate(handler, '_vertices', [[0, 0] as [number, number], [10, 0] as [number, number]]);

      callPrivate(handler, '_onDblClick', {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent);

      expect(map.fire).not.toHaveBeenCalledWith('feature_created', expect.anything());
    });
  });

  describe('polyline completion', () => {
    it('commits polyline with 2+ vertices on dblclick', () => {
      const layer = {
        name: 'lines',
        geometry_type: 'polyline',
        shapes: [] as unknown[],
        data: { getRecords: () => [] as Record<string, unknown>[] },
      };
      const source = createMockSource({ layers: [layer] });
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polyline' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);
      setPrivate(handler, '_vertices', [[0, 0] as [number, number], [10, 10] as [number, number]]);

      callPrivate(handler, '_onDblClick', {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent);

      expect(map.fire).toHaveBeenCalledWith(
        'feature_created',
        expect.objectContaining({
          geometryType: 'polyline',
          source: 'src1',
        }),
      );
    });
  });

  describe('escape cancels drawing', () => {
    it('clears vertices on Escape key', () => {
      const source = createMockSource();
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });

      setPrivate(handler, '_map', map);
      setPrivate(handler, '_enabled', true);
      setPrivate(handler, '_vertices', [[0, 0] as [number, number], [10, 0] as [number, number]]);

      callPrivate(handler, '_onKeyDown', { key: 'Escape' } as KeyboardEvent);

      const vertices = getPrivate(handler, '_vertices') as [number, number][];
      expect(vertices).toHaveLength(0);
      expect(map.clearEditDrawState).toHaveBeenCalled();
    });
  });

  describe('arc appending', () => {
    it('appends arc vertices to existing arc collection', () => {
      const source = createMockSource();
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polyline' });
      setPrivate(handler, '_map', map);

      const updateVertexData = vi.fn();
      const mockArcs = {
        getVertexData: () => ({
          xx: new Float64Array([0, 10]),
          yy: new Float64Array([0, 10]),
          nn: new Int32Array([2]),
          ii: new Int32Array([0]),
          zz: null,
          bb: new Float64Array([0, 0, 10, 10]),
        }),
        updateVertexData,
        transformPoints: vi.fn(),
      };

      const newArcId = callPrivate(handler, '_appendArc', mockArcs, [
        [20, 20] as [number, number],
        [30, 30] as [number, number],
      ]) as number;

      expect(newArcId).toBe(1); // old arc count = 1, new arc ID = 1
      expect(updateVertexData).toHaveBeenCalledTimes(1);

      const [nn, xx, yy, zz] = updateVertexData.mock.calls[0];
      expect(nn.length).toBe(2); // 1 old arc + 1 new
      expect(xx.length).toBe(4); // 2 old + 2 new points
      expect(xx[2]).toBe(20);
      expect(xx[3]).toBe(30);
      expect(yy[2]).toBe(20);
      expect(yy[3]).toBe(30);
      expect(nn[1]).toBe(2); // new arc has 2 vertices
      expect(zz).toBeNull(); // no zz in original
    });

    it('preserves zz array with Infinity for new vertices', () => {
      const source = createMockSource();
      const map = createMockMap({ src1: source });
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polyline' });
      setPrivate(handler, '_map', map);

      const updateVertexData = vi.fn();
      const mockArcs = {
        getVertexData: () => ({
          xx: new Float64Array([0]),
          yy: new Float64Array([0]),
          nn: new Int32Array([1]),
          ii: new Int32Array([0]),
          zz: new Float64Array([Infinity]),
          bb: new Float64Array([0, 0, 0, 0]),
        }),
        updateVertexData,
        transformPoints: vi.fn(),
      };

      callPrivate(handler, '_appendArc', mockArcs, [[5, 5] as [number, number]]);

      const [, , , zz] = updateVertexData.mock.calls[0];
      expect(zz).not.toBeNull();
      expect(zz.length).toBe(2);
      expect(zz[1]).toBe(Infinity);
    });
  });

  describe('_resolveTargetLayer', () => {
    it('finds layer matching geometry type', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });
      const layers = [
        { name: 'lines', geometry_type: 'polyline', shapes: [] },
        { name: 'polys', geometry_type: 'polygon', shapes: [] },
      ];
      const result = callPrivate(handler, '_resolveTargetLayer', layers);
      expect(result).toBe(layers[1]);
    });

    it('falls back to first layer when no match', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'point' });
      const layers = [{ name: 'polys', geometry_type: 'polygon', shapes: [] }];
      const result = callPrivate(handler, '_resolveTargetLayer', layers);
      expect(result).toBe(layers[0]);
    });
  });

  // ---------------------------------------------------------------------------
  // Handler-only tests
  // ---------------------------------------------------------------------------

  describe('enable/disable lifecycle', () => {
    let windowAddEventListener: typeof window.addEventListener;
    let windowRemoveEventListener: typeof window.removeEventListener;

    beforeEach(() => {
      // Stub window.addEventListener/removeEventListener for node test env
      windowAddEventListener = vi.fn() as any;
      windowRemoveEventListener = vi.fn() as any;
      vi.stubGlobal('window', {
        addEventListener: windowAddEventListener,
        removeEventListener: windowRemoveEventListener,
      });
    });

    it('enable() without source/type throws', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any);
      expect(() => handler.enable()).toThrow(/source\+type required/);
    });

    it('after setOptions({source,type}), enable() sets edit mode and isEnabled true', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any);
      handler.setOptions({ source: 'src1', type: 'polygon' });
      handler.enable();
      expect(map.setEditMode).toHaveBeenCalledWith('draw');
      expect(handler.isEnabled()).toBe(true);
    });

    it('disable() calls setEditMode("none"), clearEditDrawState, and isEnabled false', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });
      handler.enable();
      map.setEditMode.mockClear();
      handler.disable();
      expect(map.setEditMode).toHaveBeenCalledWith('none');
      expect(map.clearEditDrawState).toHaveBeenCalled();
      expect(handler.isEnabled()).toBe(false);
    });

    it('getCursor: crosshair when enabled, null when disabled (DX P11)', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any);
      expect(handler.getCursor()).toBeNull();
      handler.setOptions({ source: 'src1', type: 'polygon' });
      handler.enable();
      expect(handler.getCursor()).toBe('crosshair');
      handler.disable();
      expect(handler.getCursor()).toBeNull();
    });

    it('editmodechange with non-draw mode calls _quietDisable (isEnabled false, setEditMode NOT called again)', () => {
      const map = createMockMap();
      const handler = new DrawFeatureHandler(map as any, { source: 'src1', type: 'polygon' });
      handler.enable();
      map.setEditMode.mockClear();

      // Simulate the editmodechange event that was registered in the constructor
      // Find the 'editmodechange' listener registered via map.on
      const onCalls = map.on.mock.calls;
      const editmodechangeCall = onCalls.find((c: any[]) => c[0] === 'editmodechange');
      expect(editmodechangeCall).toBeTruthy();
      const listener = editmodechangeCall[1] as (e: { mode: string }) => void;

      // Fire it with a non-draw mode
      listener({ mode: 'vertex' });

      expect(handler.isEnabled()).toBe(false);
      // setEditMode should NOT have been called again (quietDisable doesn't call it)
      expect(map.setEditMode).not.toHaveBeenCalled();
    });
  });
});
