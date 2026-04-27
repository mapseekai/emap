import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { VertexEditControl } from './vertex-edit-control';

type MockMap = {
  getCanvasContainer: () => { getBoundingClientRect: () => { left: number; top: number } };
  unproject: (px: number, py: number) => [number, number];
  setEditVertexState: (state: unknown) => void;
  render: () => void;
  fire: (type: string, payload: unknown) => void;
  getSource?: (id: string) => { refreshDisplayArcs?: () => void } | undefined;
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

describe('VertexEditControl', () => {
  const originalFindNearestVertices = Reflect.get(mapshaper.internal as object, 'findNearestVertices');
  const originalSnapVerticesToPoint = Reflect.get(mapshaper.internal as object, 'snapVerticesToPoint');

  beforeEach(() => {
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', vi.fn(() => []));
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', vi.fn());
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'findNearestVertices', originalFindNearestVertices);
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', originalSnapVerticesToPoint);
  });

  it('moves all shared vertices during drag', () => {
    const control = new VertexEditControl();
    const snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);

    const mapMock: MockMap = {
      getCanvasContainer: () => ({
        getBoundingClientRect: () => ({ left: 10, top: 20 })
      }),
      unproject: () => [11, 22],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn()
    };

    setPrivate(control, '_map', mapMock);
    setPrivate(control, '_hoverVertexIds', [4, 9, 11]);
    setPrivate(control, '_hoveredFeature', {
      id: 2,
      source: 'src-a',
      layer: 'layer-a',
      shape: [[1]],
      arcs: {
        getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }),
        getVertex2: () => [0, 0]
      },
      geometryType: 'polyline'
    });

    callPrivate(control, '_handleDrag', { clientX: 100, clientY: 120 } as unknown as MouseEvent);

    expect(snapSpy).toHaveBeenCalledWith([4, 9, 11], [11, 22], expect.any(Object));
    expect(mapMock.render).toHaveBeenCalled();
  });

  it('fires vertex_moved with compatibility fields and refreshes arc bbox', () => {
    const control = new VertexEditControl();
    const transformPoints = vi.fn();
    const fireSpy = vi.fn();
    const renderSpy = vi.fn();
    const refreshDisplayArcs = vi.fn();

    const mapMock: MockMap = {
      getCanvasContainer: () => ({
        getBoundingClientRect: () => ({ left: 0, top: 0 })
      }),
      unproject: () => [123.45, 67.89],
      setEditVertexState: vi.fn(),
      render: renderSpy,
      fire: fireSpy,
      getSource: vi.fn(() => ({ refreshDisplayArcs }))
    };

    setPrivate(control, '_map', mapMock);
    setPrivate(control, '_dragging', true);
    setPrivate(control, '_hoverVertexIds', [8, 20]);
    setPrivate(control, '_hoveredFeature', {
      id: 3,
      source: 'demo-source',
      layer: 'roads',
      shape: [[1]],
      arcs: {
        getArcIter: () => ({ x: 0, y: 0, hasNext: () => false }),
        getVertex2: () => [0, 0],
        transformPoints
      },
      geometryType: 'polyline'
    });

    callPrivate(control, '_onMouseUp', { clientX: 1, clientY: 2 } as unknown as MouseEvent);

    expect(transformPoints).toHaveBeenCalledTimes(1);
    expect(refreshDisplayArcs).toHaveBeenCalledTimes(1);
    expect(fireSpy).toHaveBeenCalledWith(
      'vertex_moved',
      expect.objectContaining({
        id: 3,
        source: 'demo-source',
        layer: 'roads',
        vertexIndex: 8,
        vertexIds: [8, 20],
        coords: [123.45, 67.89]
      })
    );
    expect(renderSpy).toHaveBeenCalled();
  });
});
