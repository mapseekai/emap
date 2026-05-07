import { describe, expect, it } from 'vitest';
import { parseCommandHeads, shouldUseWorker } from './worker-routing';

describe('parseCommandHeads', () => {
  it.each([
    ['-target X -dissolve foo', ['target', 'dissolve']],
    ['-rename-fields A=B', ['rename-fields']],
    ['-target X', ['target']],
    ['', []],
  ])('parses %p → %p', (cmd, expected) => {
    expect(parseCommandHeads(cmd)).toEqual(expected);
  });

  // Known limitation: the regex doesn't model quote scope. In-tree
  // command builders never put hyphenated tokens inside quoted args
  // (layer / field names go through `quoteCliArg`, which doesn't add
  // them). If a future caller does, the routing decision may include
  // false-positive heads — that biases toward "use worker" rather than
  // toward correctness, which is fine for routing.
  it('does not understand quote scope; documents the limitation', () => {
    expect(parseCommandHeads('-target "weird -dash" -dissolve foo')).toEqual([
      'target',
      'dash',
      'dissolve',
    ]);
  });
});

describe('shouldUseWorker', () => {
  const T = 50_000;

  it('mode=false always returns false', () => {
    expect(shouldUseWorker('-buffer 5', 1_000_000, false, T)).toBe(false);
    expect(shouldUseWorker('-rename-fields A=B', 0, false, T)).toBe(false);
  });

  it('mode=true always returns true', () => {
    expect(shouldUseWorker('-rename-fields A=B', 0, true, T)).toBe(true);
    expect(shouldUseWorker('-buffer 5', 1, true, T)).toBe(true);
  });

  describe('mode=auto', () => {
    it('cheap-only commands stay on main thread regardless of vertex count', () => {
      expect(shouldUseWorker('-rename-fields A=B', 1_000_000, 'auto', T)).toBe(false);
      expect(shouldUseWorker('-target X -sort foo', 1_000_000, 'auto', T)).toBe(false);
      expect(shouldUseWorker('-filter-fields a,b -drop', 1_000_000, 'auto', T)).toBe(false);
    });

    it('expensive commands trip at half the threshold', () => {
      // T=50000, half = 25000
      expect(shouldUseWorker('-buffer 5', 24_999, 'auto', T)).toBe(false);
      expect(shouldUseWorker('-buffer 5', 25_000, 'auto', T)).toBe(true);
      expect(shouldUseWorker('-target X -dissolve foo', 30_000, 'auto', T)).toBe(true);
    });

    it('mixed cheap + expensive treats overall as expensive', () => {
      // -target is cheap, -clean is expensive — we want worker for the clean.
      expect(shouldUseWorker('-target X -clean', 30_000, 'auto', T)).toBe(true);
    });

    it('non-classified commands use the full threshold', () => {
      expect(shouldUseWorker('-each "this.x = 1"', 49_999, 'auto', T)).toBe(false);
      expect(shouldUseWorker('-each "this.x = 1"', 50_000, 'auto', T)).toBe(true);
    });
  });
});
