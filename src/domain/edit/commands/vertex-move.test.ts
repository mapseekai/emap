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
    // PR-13: edit commands now mark the LOD dirty (lazy) instead of calling
    // the eager `refreshDisplayArcs`. Mock both so older + newer assertions
    // can both inspect call counts.
    return {
      refreshDisplayArcs: vi.fn(),
      markDisplayArcsDirty: vi.fn(),
    } as unknown as TopologySource;
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
    expect((source as any).markDisplayArcsDirty).toHaveBeenCalled();
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

  describe('mergeable + merge', () => {
    it('matches another VertexMoveCommand on identical (source, vertexIds)', () => {
      const arcs = {} as any;
      const source = makeSource();
      const a = new VertexMoveCommand({
        vertexIds: [1, 2],
        from: [0, 0],
        to: [1, 1],
        arcs,
        source,
      });
      const b = new VertexMoveCommand({
        vertexIds: [1, 2],
        from: [1, 1],
        to: [2, 2],
        arcs,
        source,
      });
      expect(b.mergeable(a)).toBe(true);
    });

    it('rejects merge when sources differ', () => {
      const arcs = {} as any;
      const a = new VertexMoveCommand({
        vertexIds: [1],
        from: [0, 0],
        to: [1, 1],
        arcs,
        source: makeSource(),
      });
      const b = new VertexMoveCommand({
        vertexIds: [1],
        from: [1, 1],
        to: [2, 2],
        arcs,
        source: makeSource(),
      });
      expect(b.mergeable(a)).toBe(false);
    });

    it('rejects merge when vertexIds differ', () => {
      const arcs = {} as any;
      const source = makeSource();
      const a = new VertexMoveCommand({
        vertexIds: [1, 2],
        from: [0, 0],
        to: [1, 1],
        arcs,
        source,
      });
      const b = new VertexMoveCommand({
        vertexIds: [1, 3],
        from: [1, 1],
        to: [2, 2],
        arcs,
        source,
      });
      expect(b.mergeable(a)).toBe(false);
    });

    it('merge() adopts the new `to` and preserves the original `from`', () => {
      const arcs = {} as any;
      const source = makeSource();
      const a = new VertexMoveCommand({ vertexIds: [1], from: [0, 0], to: [1, 1], arcs, source });
      const b = new VertexMoveCommand({ vertexIds: [1], from: [1, 1], to: [5, 7], arcs, source });
      a.merge(b);
      // do() now goes to [5,7]; undo() reverts all the way to [0,0].
      a.do();
      expect(snapSpy).toHaveBeenLastCalledWith([1], [5, 7], arcs);
      a.undo();
      expect(snapSpy).toHaveBeenLastCalledWith([1], [0, 0], arcs);
    });
  });
});
