import { describe, expect, it, vi } from 'vitest';
import { CompositeCommand } from './composite';
import type { EditCommand } from '../edit-command';

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

describe('CompositeCommand', () => {
  it('do() invokes children in declared order', () => {
    const order: string[] = [];
    const a = { do: () => order.push('a'), undo: () => {} };
    const b = { do: () => order.push('b'), undo: () => {} };
    const c = { do: () => order.push('c'), undo: () => {} };
    new CompositeCommand([a, b, c]).do();
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('undo() invokes children in reverse order', () => {
    const order: string[] = [];
    const a = { do: () => {}, undo: () => order.push('a') };
    const b = { do: () => {}, undo: () => order.push('b') };
    const c = { do: () => {}, undo: () => order.push('c') };
    new CompositeCommand([a, b, c]).undo();
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('forwards calls to spies on each child exactly once per pass', () => {
    const cmds = [makeCmd(), makeCmd(), makeCmd()];
    const composite = new CompositeCommand(cmds);
    composite.do();
    composite.undo();
    for (const c of cmds) {
      expect(c.do).toHaveBeenCalledTimes(1);
      expect(c.undo).toHaveBeenCalledTimes(1);
    }
  });

  it('label propagates from constructor', () => {
    const composite = new CompositeCommand([], 'Delete 3 features');
    expect(composite.label).toBe('Delete 3 features');
  });

  it('empty children list is a no-op', () => {
    const composite = new CompositeCommand([]);
    expect(() => composite.do()).not.toThrow();
    expect(() => composite.undo()).not.toThrow();
  });
});
