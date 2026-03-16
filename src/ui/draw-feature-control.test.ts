import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DrawFeatureControl } from './draw-feature-control';
import type { DrawFeatureControlOptions } from './draw-feature-control';

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
  };
}

function createMockSource(options?: {
  layers?: unknown[];
  vertexData?: { xx: Float64Array; yy: Float64Array; nn: Int32Array; ii: Int32Array; zz: null; bb: Float64Array };
}) {
  const updateVertexData = vi.fn();
  return {
    id: 'test-source',
    type: 'topology' as const,
    on: vi.fn(),
    off: vi.fn(),
    fire: vi.fn(),
    getArcs: vi.fn(() => ({
      getVertexData: () => options?.vertexData || {
        xx: new Float64Array([0, 10, 20]),
        yy: new Float64Array([0, 10, 20]),
        nn: new Int32Array([3]),
        ii: new Int32Array([0]),
        zz: null,
        bb: new Float64Array([0, 0, 20, 20]),
      },
      updateVertexData,
      size: () => (options?.vertexData?.nn.length || 1),
      transformPoints: vi.fn(),
    })),
    getLayers: vi.fn(() => options?.layers || [
      {
        name: 'test-layer',
        geometry_type: 'polygon',
        shapes: [],
        data: { getRecords: () => [] },
      },
    ]),
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
        getVertexData: () => options?.vertexData || {
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

describe('DrawFeatureControl', () => {
  describe('vertex placement', () => {
    it('adds a vertex on click for polygon mode', () => {
      const source = createMockSource();
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);

      // Simulate click
      callPrivate(control, '_onClick', {
        clientX: 100,
        clientY: 200,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent);

      const vertices = getPrivate(control, '_vertices') as [number, number][];
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'point' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);

      callPrivate(control, '_onClick', {
        clientX: 50,
        clientY: 60,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as MouseEvent);

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
      const map = createMockMap({ 'src1': source });
      // project returns identity
      map.project.mockImplementation((x: number, y: number) => [x, y]);

      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon', snapThreshold: 15 });
      setPrivate(control, '_map', map);

      // Cursor at (105, 105) — within 15px of (100, 100)
      const snap = callPrivate(control, '_findSnapTarget', 105, 105) as [number, number] | null;
      expect(snap).not.toBeNull();
      expect(snap![0]).toBe(100);
      expect(snap![1]).toBe(100);
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
      const map = createMockMap({ 'src1': source });
      map.project.mockImplementation((x: number, y: number) => [x, y]);

      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon', snapThreshold: 5 });
      setPrivate(control, '_map', map);

      const snap = callPrivate(control, '_findSnapTarget', 120, 120) as [number, number] | null;
      expect(snap).toBeNull();
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);
      setPrivate(control, '_vertices', [
        [0, 0] as [number, number],
        [10, 0] as [number, number],
        [10, 10] as [number, number],
      ]);

      callPrivate(control, '_onDblClick', {
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);
      setPrivate(control, '_vertices', [
        [0, 0] as [number, number],
        [10, 0] as [number, number],
      ]);

      callPrivate(control, '_onDblClick', {
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polyline' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);
      setPrivate(control, '_vertices', [
        [0, 0] as [number, number],
        [10, 10] as [number, number],
      ]);

      callPrivate(control, '_onDblClick', {
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon' });

      setPrivate(control, '_map', map);
      setPrivate(control, '_active', true);
      setPrivate(control, '_vertices', [
        [0, 0] as [number, number],
        [10, 0] as [number, number],
      ]);

      callPrivate(control, '_onKeyDown', { key: 'Escape' } as KeyboardEvent);

      const vertices = getPrivate(control, '_vertices') as [number, number][];
      expect(vertices).toHaveLength(0);
      expect(map.clearEditDrawState).toHaveBeenCalled();
    });
  });

  describe('arc appending', () => {
    it('appends arc vertices to existing arc collection', () => {
      const source = createMockSource();
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polyline' });
      setPrivate(control, '_map', map);

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

      const newArcId = callPrivate(control, '_appendArc', mockArcs, [
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
      const map = createMockMap({ 'src1': source });
      const control = new DrawFeatureControl({ source: 'src1', type: 'polyline' });
      setPrivate(control, '_map', map);

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

      callPrivate(control, '_appendArc', mockArcs, [
        [5, 5] as [number, number],
      ]);

      const [, , , zz] = updateVertexData.mock.calls[0];
      expect(zz).not.toBeNull();
      expect(zz.length).toBe(2);
      expect(zz[1]).toBe(Infinity);
    });
  });

  describe('_resolveTargetLayer', () => {
    it('finds layer matching geometry type', () => {
      const control = new DrawFeatureControl({ source: 'src1', type: 'polygon' });
      const layers = [
        { name: 'lines', geometry_type: 'polyline', shapes: [] },
        { name: 'polys', geometry_type: 'polygon', shapes: [] },
      ];
      const result = callPrivate(control, '_resolveTargetLayer', layers);
      expect(result).toBe(layers[1]);
    });

    it('falls back to first layer when no match', () => {
      const control = new DrawFeatureControl({ source: 'src1', type: 'point' });
      const layers = [
        { name: 'polys', geometry_type: 'polygon', shapes: [] },
      ];
      const result = callPrivate(control, '_resolveTargetLayer', layers);
      expect(result).toBe(layers[0]);
    });
  });
});
