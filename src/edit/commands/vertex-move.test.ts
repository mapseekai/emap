import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mapshaper from 'mapshaper';
import { VertexMoveCommand } from './vertex-move';
import type { TopologySource } from '../../source/source';

describe('VertexMoveCommand', () => {
  const original = Reflect.get(mapshaper.internal as object, 'snapVerticesToPoint');
  let snapSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    snapSpy = vi.fn();
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', snapSpy);
  });

  afterEach(() => {
    Reflect.set(mapshaper.internal as object, 'snapVerticesToPoint', original);
  });

  function makeSource(): TopologySource {
    return { refreshDisplayArcs: vi.fn() } as unknown as TopologySource;
  }

  it('do() snaps vertices to the recorded `to` coordinate', () => {
    const arcs = {} as any;
    const source = makeSource();
    const cmd = new VertexMoveCommand({
      vertexIds: [1, 2, 3],
      from: [0, 0],
      to: [10, 20],
      arcs,
      source,
    });
    cmd.do();
    expect(snapSpy).toHaveBeenCalledWith([1, 2, 3], [10, 20], arcs);
    expect(source.refreshDisplayArcs).toHaveBeenCalled();
  });

  it('undo() snaps vertices back to the recorded `from` coordinate', () => {
    const arcs = {} as any;
    const source = makeSource();
    const cmd = new VertexMoveCommand({
      vertexIds: [4, 5],
      from: [-1, -2],
      to: [9, 8],
      arcs,
      source,
    });
    cmd.undo();
    expect(snapSpy).toHaveBeenCalledWith([4, 5], [-1, -2], arcs);
  });

  it('round-trip do() then undo() produces equivalent calls', () => {
    const arcs = {} as any;
    const source = makeSource();
    const cmd = new VertexMoveCommand({
      vertexIds: [0],
      from: [1, 1],
      to: [2, 2],
      arcs,
      source,
    });
    cmd.do();
    cmd.undo();
    expect(snapSpy).toHaveBeenNthCalledWith(1, [0], [2, 2], arcs);
    expect(snapSpy).toHaveBeenNthCalledWith(2, [0], [1, 1], arcs);
  });
});
