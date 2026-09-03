import { describe, expect, it } from 'vitest';
import { shouldUseWorkerForHeads } from './worker-routing';

describe('shouldUseWorkerForHeads', () => {
  const T = 50_000;

  it('mode=false always returns false', () => {
    expect(shouldUseWorkerForHeads(['buffer'], 1_000_000, false, T)).toBe(false);
    expect(shouldUseWorkerForHeads(['rename-fields'], 0, false, T)).toBe(false);
  });

  it('mode=true always returns true', () => {
    expect(shouldUseWorkerForHeads(['rename-fields'], 0, true, T)).toBe(true);
    expect(shouldUseWorkerForHeads(['buffer'], 1, true, T)).toBe(true);
  });

  describe('mode=auto', () => {
    it('cheap-only commands stay on main thread regardless of vertex count', () => {
      expect(shouldUseWorkerForHeads(['rename-fields'], 1_000_000, 'auto', T)).toBe(false);
      expect(shouldUseWorkerForHeads(['target', 'sort'], 1_000_000, 'auto', T)).toBe(false);
      expect(shouldUseWorkerForHeads(['filter-fields', 'drop'], 1_000_000, 'auto', T)).toBe(false);
    });

    it('expensive commands trip at half the threshold', () => {
      // T=50000, half = 25000
      expect(shouldUseWorkerForHeads(['buffer'], 24_999, 'auto', T)).toBe(false);
      expect(shouldUseWorkerForHeads(['buffer'], 25_000, 'auto', T)).toBe(true);
      expect(shouldUseWorkerForHeads(['target', 'dissolve'], 30_000, 'auto', T)).toBe(true);
    });

    it('mixed cheap + expensive treats overall as expensive', () => {
      // target is cheap, clean is expensive — we want worker for the clean.
      expect(shouldUseWorkerForHeads(['target', 'clean'], 30_000, 'auto', T)).toBe(true);
    });

    it('non-classified commands use the full threshold', () => {
      expect(shouldUseWorkerForHeads(['each'], 49_999, 'auto', T)).toBe(false);
      expect(shouldUseWorkerForHeads(['each'], 50_000, 'auto', T)).toBe(true);
    });
  });
});
describe('recordCount routing', () => {
  it('classify routes by recordCount even at vertexCount=0', () => {
    expect(shouldUseWorkerForHeads(['classify'], 0, 'auto', 100, 10_000)).toBe(true);
    expect(shouldUseWorkerForHeads(['classify'], 0, 'auto', 100, 50)).toBe(false);
  });
  it('non-record commands ignore recordCount', () => {
    expect(shouldUseWorkerForHeads(['simplify'], 0, 'auto', 100, 10_000)).toBe(false);
  });
  it('mode overrides still win', () => {
    expect(shouldUseWorkerForHeads(['classify'], 0, false, 100, 10_000)).toBe(false);
    expect(shouldUseWorkerForHeads(['classify'], 0, true, 100, 0)).toBe(true);
  });
});
