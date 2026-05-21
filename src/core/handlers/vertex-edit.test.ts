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

describe('VertexEditHandler', () => {
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
    const mapMock: MockMap = {
      getCanvasContainer: () => ({
        getBoundingClientRect: () => ({ left: 10, top: 20 })
      }),
      unproject: () => [11, 22],
      setEditVertexState: vi.fn(),
      render: vi.fn(),
      fire: vi.fn()
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
        getVertex2: () => [0, 0]
      },
      geometryType: 'polyline'
    });

    // clientX:100, clientY:120, rect left:10, top:20 → px=90, py=100
    callPrivate(handler, '_handleDrag', 90, 100);

    expect(snapSpy).toHaveBeenCalledWith([4, 9, 11], [11, 22], expect.any(Object));
    expect(mapMock.render).toHaveBeenCalled();
  });

  it('fires vertex_moved with compatibility fields and refreshes arc bbox', () => {
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
        transformPoints
      },
      geometryType: 'polyline'
    });

    // clientX:1, clientY:2, rect left:0, top:0 → px=1, py=2
    callPrivate(handler, '_finishDrag', 1, 2);

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
});

describe('VertexEditHandler context-menu CSS-token migration (DX P4)', () => {
  it('_showContextMenu sets class-based DOM and only dynamic position inline', () => {
    document.getElementById('emap-ctx-menu')?.remove();
    const mapMock = { setEditMode: () => {}, on: () => {}, off: () => {}, render: () => {}, clearEditVertexState: () => {} } as any;
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
    const mapMock = { setEditMode: () => {}, on: () => {}, off: () => {}, render: () => {}, clearEditVertexState: () => {} } as any;
    const handler = new VertexEditHandler(mapMock);
    let called = 0;
    Reflect.get(handler, '_showContextMenu').call(handler, 10, 20, () => { called++; });
    const item = document.querySelector('#emap-ctx-menu > div') as HTMLDivElement;
    item.click();
    expect(called).toBe(1);
    expect(document.getElementById('emap-ctx-menu')).toBeNull();
  });
});
