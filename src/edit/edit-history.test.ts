import { describe, expect, it, vi } from 'vitest';
import { EditHistory } from './edit-history';
import type { EditCommand } from './edit-command';

function makeCmd(
  label?: string,
): EditCommand & { do: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> } {
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
  do: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
} {
  return {
    do: vi.fn(),
    undo: vi.fn(),
    label,
    invalidatesPriorCommands: true,
  };
}

describe('EditHistory stale marker (history barrier)', () => {
  it('pushing an `invalidatesPriorCommands` command marks every prior entry stale', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    const b = makeCmd('b');
    const dr = makeBarrier('clip');
    h.push(a);
    h.push(b);
    expect(a.stale).toBeUndefined();
    expect(b.stale).toBeUndefined();
    h.push(dr);
    expect(a.stale).toBe(true);
    expect(b.stale).toBe(true);
    // The barrier itself remains undoable
    expect(dr.stale).toBeUndefined();
  });

  it('snapshot reports staleCount and topIsStale across the barrier', () => {
    const h = new EditHistory();
    h.push(makeCmd('a'));
    h.push(makeCmd('b'));
    h.push(makeBarrier('clip'));
    let snap = h.snapshot();
    expect(snap.staleCount).toBe(2);
    expect(snap.topIsStale).toBe(false); // barrier is on top, not stale
    expect(snap.label).toBe('clip');
    // After undoing the barrier, the top of undo is now stale.
    h.undo();
    snap = h.snapshot();
    expect(snap.canUndo).toBe(true);
    expect(snap.staleCount).toBe(2);
    expect(snap.topIsStale).toBe(true);
    expect(snap.label).toBe('b');
  });

  it('undo skips a stale command without invoking its undo() and surfaces skippedStale once', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    h.push(a);
    h.push(makeBarrier('clip'));
    h.undo(); // pop barrier — barrier.undo() invoked
    expect(h.snapshot().skippedStale).toBeUndefined();
    const popped = h.undo();
    expect(popped).toBe(a);
    expect(a.undo).not.toHaveBeenCalled();
    const snap = h.snapshot();
    expect(snap.skippedStale).toBe(true);
    expect(snap.canUndo).toBe(false);
    expect(snap.canRedo).toBe(true);
  });

  it('redo skips a stale command without invoking its do() and surfaces skippedStale', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    h.push(a);
    h.push(makeBarrier('clip'));
    h.undo(); // barrier
    h.undo(); // a (stale, skipped)
    // both now on redo stack: [barrier, a] from bottom to top — wait,
    // pushed in pop order: barrier first, then a. So redoStack top is a.
    const redone = h.redo();
    expect(redone).toBe(a);
    expect(a.do).not.toHaveBeenCalled();
    expect(h.snapshot().skippedStale).toBe(true);
  });

  it('a barrier push on a non-empty stack also drops the redo stack', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    h.push(a);
    h.undo();
    expect(h.canRedo()).toBe(true);
    h.push(makeBarrier('clip'));
    expect(h.canRedo()).toBe(false);
  });

  it('skippedStale resets on the next non-stale traversal', () => {
    const h = new EditHistory();
    const a = makeCmd('a');
    h.push(a);
    h.push(makeBarrier('clip'));
    h.undo(); // barrier — non-stale
    expect(h.snapshot().skippedStale).toBeFalsy();
    h.undo(); // a — stale, skip
    expect(h.snapshot().skippedStale).toBe(true);
    h.redo(); // a — still stale, skip
    expect(h.snapshot().skippedStale).toBe(true);
    h.redo(); // barrier — non-stale, runs do()
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
  do: ReturnType<typeof vi.fn>;
  undo: ReturnType<typeof vi.fn>;
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
