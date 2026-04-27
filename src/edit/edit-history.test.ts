import { describe, expect, it, vi } from 'vitest';
import { EditHistory } from './edit-history';
import type { EditCommand } from './edit-command';

function makeCmd(label?: string): EditCommand & { do: ReturnType<typeof vi.fn>; undo: ReturnType<typeof vi.fn> } {
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

  it('undo invokes the command\'s undo() and shifts it to the redo stack', () => {
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
    expect(h.snapshot()).toEqual({ canUndo: true, canRedo: false, label: 'second' });
    h.undo();
    expect(h.snapshot()).toEqual({ canUndo: true, canRedo: true, label: 'first' });
  });
});
