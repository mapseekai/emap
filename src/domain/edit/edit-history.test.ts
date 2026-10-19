import { describe, expect, it, vi } from 'vitest';
import { EditHistory } from './edit-history';
import type { EditCommand } from './edit-command';

function makeCmd(label?: string): EditCommand & {
  do: ReturnType<typeof vi.fn<() => void>>;
  undo: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    do: vi.fn(),
    undo: vi.fn(),
    label,
  };
}

describe('EditHistory', () => {
  it('starts empty', () => {
    const h = new EditHistory();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(0);
  });

  it('push records the command without invoking do()', () => {
    const h = new EditHistory();
    const cmd = makeCmd();
    h.push(cmd);
    expect(cmd.do).not.toHaveBeenCalled();
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(1);
  });

  it("undo invokes the command's undo() and shifts it to the redo stack", () => {
    const h = new EditHistory();
    const cmd = makeCmd();
    h.push(cmd);
    const popped = h.undo();
    expect(popped).toBe(cmd);
    expect(cmd.undo).toHaveBeenCalledTimes(1);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo invokes do() and moves the command back to the undo stack', () => {
    const h = new EditHistory();
    const cmd = makeCmd();
    h.push(cmd);
    h.undo();
    const replayed = h.redo();
    expect(replayed).toBe(cmd);
    expect(cmd.do).toHaveBeenCalledTimes(1);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('keeps a command undoable when undo throws', () => {
    const h = new EditHistory();
    const cmd = makeCmd();
    cmd.undo.mockImplementation(() => {
      throw new Error('undo failed');
    });
    h.push(cmd);

    expect(() => h.undo()).toThrow('undo failed');
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('keeps a command redoable when redo throws', () => {
    const h = new EditHistory();
    const cmd = makeCmd();
    h.push(cmd);
    h.undo();
    cmd.do.mockImplementation(() => {
      throw new Error('redo failed');
    });

    expect(() => h.redo()).toThrow('redo failed');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('undo on an empty stack returns null', () => {
    const h = new EditHistory();
    expect(h.undo()).toBeNull();
  });

  it('redo on an empty stack returns null', () => {
    const h = new EditHistory();
    expect(h.redo()).toBeNull();
  });

  it('pushing a new command after undo clears the redo stack', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    const b = makeCmd('b');
    h.push(a);
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push(b);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(1);
  });

  it('respects maxSize by evicting oldest entries', () => {
    const h = new EditHistory({ maxSize: 3 });
    const cmds = [makeCmd('a'), makeCmd('b'), makeCmd('c'), makeCmd('d')];
    for (const c of cmds) h.push(c);
    expect(h.size()).toBe(3);
    // The oldest ('a') should have been evicted; undoing 3 times reaches b/c/d in reverse
    h.undo(); // d
    h.undo(); // c
    h.undo(); // b
    expect(cmds[3].undo).toHaveBeenCalledTimes(1);
    expect(cmds[2].undo).toHaveBeenCalledTimes(1);
    expect(cmds[1].undo).toHaveBeenCalledTimes(1);
    expect(cmds[0].undo).not.toHaveBeenCalled();
    expect(h.canUndo()).toBe(false);
  });

  it('throws on invalid maxSize', () => {
    expect(() => new EditHistory({ maxSize: 0 })).toThrow();
    expect(() => new EditHistory({ maxSize: -1 })).toThrow();
  });

  it('clear empties both stacks', () => {
    const h = new EditHistory();
    h.push(makeCmd('a'));
    h.push(makeCmd('b'));
    h.undo();
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.size()).toBe(0);
  });

  it('snapshot reflects the top command label', () => {
    const h = new EditHistory();
    h.push(makeCmd('first'));
    h.push(makeCmd('second'));
    expect(h.snapshot()).toEqual({
      canUndo: true,
      canRedo: false,
      label: 'second',
      staleCount: 0,
      topIsStale: false,
    });
    h.undo();
    expect(h.snapshot()).toEqual({
      canUndo: true,
      canRedo: true,
      label: 'first',
      staleCount: 0,
      topIsStale: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Stale-marker flow (PR-6, H2)
// ---------------------------------------------------------------------------

function makeBarrier(label?: string): EditCommand & {
  do: ReturnType<typeof vi.fn<() => void>>;
  undo: ReturnType<typeof vi.fn<() => void>>;
} {
  return {
    do: vi.fn(),
    undo: vi.fn(),
    label,
    invalidatesPriorCommands: true,
  };
}

describe('EditHistory stale marker (history barrier)', () => {
  it('releases prior commands and retains one lightweight stale boundary', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    const b = makeCmd('b');
    const barrier = makeBarrier('clip');
    h.push(a);
    h.push(b);
    h.push(barrier);

    expect(a.stale).toBeUndefined();
    expect(b.stale).toBeUndefined();
    expect(h.size()).toBe(2);
    expect(h.snapshot()).toMatchObject({
      label: 'clip',
      staleCount: 1,
      topIsStale: false,
    });
  });

  it('exposes the collapsed boundary after undoing the dataset replacement', () => {
    const h = new EditHistory();
    h.push(makeCmd('a'));
    h.push(makeCmd('b'));
    h.push(makeBarrier('clip'));
    h.undo();

    expect(h.snapshot()).toMatchObject({
      canUndo: true,
      label: 'Earlier edits unavailable',
      staleCount: 1,
      topIsStale: true,
    });
  });

  it('skips the lightweight stale boundary without retaining old commands', () => {
    const h = new EditHistory();
    const old = makeCmd('old');
    h.push(old);
    h.push(makeBarrier('clip'));
    h.undo();
    const boundary = h.undo();

    expect(boundary?.label).toBe('Earlier edits unavailable');
    expect(old.undo).not.toHaveBeenCalled();
    expect(h.snapshot().skippedStale).toBe(true);
    expect(h.canUndo()).toBe(false);
  });

  it('redo skips the lightweight stale boundary', () => {
    const h = new EditHistory();
    h.push(makeCmd('old'));
    h.push(makeBarrier('clip'));
    h.undo();
    h.undo();

    const boundary = h.redo();
    expect(boundary?.label).toBe('Earlier edits unavailable');
    expect(h.snapshot().skippedStale).toBe(true);
  });

  it('a barrier push drops the redo stack', () => {
    const h = new EditHistory();
    h.push(makeCmd('a'));
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push(makeBarrier('clip'));
    expect(h.canRedo()).toBe(false);
  });

  it('skippedStale resets on the next non-stale traversal', () => {
    const h = new EditHistory();
    h.push(makeCmd('a'));
    h.push(makeBarrier('clip'));
    h.undo();
    h.undo();
    expect(h.snapshot().skippedStale).toBe(true);
    h.redo();
    expect(h.snapshot().skippedStale).toBe(true);
    h.redo();
    expect(h.snapshot().skippedStale).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Merge fast-path (PR-9, M2)
// ---------------------------------------------------------------------------

function makeMergeable(
  label: string,
  key: string,
): EditCommand & {
  do: ReturnType<typeof vi.fn<() => void>>;
  undo: ReturnType<typeof vi.fn<() => void>>;
  merge: ReturnType<typeof vi.fn>;
  mergeKey: string;
  mergedCount: number;
} {
  const cmd: any = {
    do: vi.fn(),
    undo: vi.fn(),
    label,
    mergeKey: key,
    mergedCount: 0,
    mergeable(prev: EditCommand): boolean {
      return (prev as any).mergeKey === this.mergeKey;
    },
    merge: vi.fn(function (this: any, next: EditCommand) {
      this.mergedCount = ((next as any).mergedCount ?? 0) + 1;
    }),
  };
  return cmd;
}

describe('EditHistory merge fast-path', () => {
  it('absorbs a follow-up command when mergeable returns true', () => {
    const h = new EditHistory();
    const a = makeMergeable('move', 'k1');
    const b = makeMergeable('move', 'k1');
    h.push(a);
    h.push(b);
    expect(h.size()).toBe(1);
    expect(a.merge).toHaveBeenCalledWith(b);
    expect(a.mergedCount).toBe(1);
  });

  it('does NOT merge when mergeKey differs', () => {
    const h = new EditHistory();
    const a = makeMergeable('move', 'k1');
    const b = makeMergeable('move', 'k2');
    h.push(a);
    h.push(b);
    expect(h.size()).toBe(2);
    expect(a.merge).not.toHaveBeenCalled();
  });

  it('clears the redo stack on merge (forward replay is invalidated)', () => {
    const h = new EditHistory();
    const a = makeMergeable('move', 'k1');
    const x = makeCmd('unrelated');
    h.push(a);
    h.push(x);
    h.undo();
    expect(h.canRedo()).toBe(true);
    const b = makeMergeable('move', 'k1');
    // 'a' is the new top after undo of 'x'. b merges into a.
    h.push(b);
    expect(h.canRedo()).toBe(false);
    expect(a.merge).toHaveBeenCalled();
  });

  it('refuses to merge into a stale top', () => {
    const h = new EditHistory();
    const a = makeMergeable('move', 'k1');
    h.push(a);
    h.push(makeBarrier('clip')); // marks `a` stale
    h.undo(); // pop barrier
    const b = makeMergeable('move', 'k1');
    h.push(b);
    // `a` is stale — merge fast-path bypassed; `b` is pushed alongside.
    expect(h.size()).toBe(2);
    expect(a.merge).not.toHaveBeenCalled();
  });
});
