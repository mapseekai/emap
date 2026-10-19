import { describe, expect, it } from 'vitest';
import { Selection } from './selection';
import type { FeatureRef } from './map';

const A: FeatureRef = { source: 's1', layer: 'l1', id: 1 };
const B: FeatureRef = { source: 's1', layer: 'l1', id: 2 };
const C: FeatureRef = { source: 's1', layer: 'l2', id: 1 };
const D: FeatureRef = { source: 's2', layer: 'l1', id: 99 };

function asKey(r: FeatureRef): string {
  return `${r.source}/${r.layer}/${r.id}`;
}

function sortedKeys(refs: FeatureRef[]): string[] {
  return refs.map(asKey).sort();
}

describe('Selection', () => {
  it.each([
    NaN,
    Infinity,
    -Infinity,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid id %s before any selection mutation', (id) => {
    const selection = new Selection();
    selection.apply([A, B], 'replace');
    const before = selection.snapshot();
    for (const mode of ['replace', 'add', 'toggle'] as const) {
      expect(() => selection.apply([C, { ...D, id }], mode)).toThrow(RangeError);
      expect(selection.snapshot()).toEqual(before);
      expect(selection.size).toBe(2);
    }
    expect(() => selection.remove([A, { ...D, id }])).toThrow(RangeError);
    expect(selection.snapshot()).toEqual(before);
  });

  it.each([
    'invalid json',
    'null',
    '{}',
    '["s", "l"]',
    '["s", "l", 0, 1]',
    '[1, "l", 0]',
    '["s", null, 0]',
    '["s", "l", null]',
    '["s", "l", "0"]',
    '["s", "l", -1]',
    '["s", "l", 0.5]',
    '["s", "l", 1e400]',
    '["s", "l", 9007199254740992]',
  ])('validates the entire snapshot before replacing live state: %s', (invalid) => {
    const selection = new Selection();
    selection.apply([A, B], 'replace');
    const before = selection.snapshot();
    expect(() =>
      selection.restore(new Set([JSON.stringify(['new', 'layer', 0]), invalid])),
    ).toThrow();
    expect(selection.snapshot()).toEqual(before);
    expect(selection.size).toBe(2);
  });

  it('restores canonical refs and reports the actual diff for equivalent encoded keys', () => {
    const selection = new Selection();
    const ref = { source: 's/"\\', layer: 'l/"\\', id: Number.MAX_SAFE_INTEGER };
    selection.apply([ref], 'replace');
    const snapshot = selection.snapshot();
    selection.clear();
    expect(selection.restore(snapshot).added).toEqual([ref]);
    expect(
      selection.restore(
        new Set([`[${JSON.stringify(ref.source)}, ${JSON.stringify(ref.layer)}, ${ref.id}]`]),
      ).changed,
    ).toBe(false);
  });
  describe('initial state', () => {
    it('is empty', () => {
      const s = new Selection();
      expect(s.size).toBe(0);
      expect(s.getAll()).toEqual([]);
      expect(s.has(A)).toBe(false);
    });
  });

  describe('apply mode=replace', () => {
    it('sets the selection to exactly the input', () => {
      const s = new Selection();
      s.apply([A, B], 'add');
      const diff = s.apply([C], 'replace');
      expect(s.size).toBe(1);
      expect(s.has(A)).toBe(false);
      expect(s.has(B)).toBe(false);
      expect(s.has(C)).toBe(true);
      expect(sortedKeys(diff.added)).toEqual([asKey(C)]);
      expect(sortedKeys(diff.removed)).toEqual([asKey(A), asKey(B)]);
      expect(diff.changed).toBe(true);
    });

    it('reports no change when replacing with the same set', () => {
      const s = new Selection();
      s.apply([A, B], 'add');
      const diff = s.apply([A, B], 'replace');
      expect(diff.changed).toBe(false);
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
    });
  });

  describe('apply mode=add', () => {
    it('unions with the existing set', () => {
      const s = new Selection();
      s.apply([A], 'replace');
      const diff = s.apply([B, C], 'add');
      expect(s.size).toBe(3);
      expect(sortedKeys(diff.added)).toEqual([asKey(B), asKey(C)]);
      expect(diff.removed).toHaveLength(0);
    });

    it('returns no change when adding a feature already present', () => {
      const s = new Selection();
      s.apply([A], 'replace');
      const diff = s.apply([A], 'add');
      expect(diff.changed).toBe(false);
      expect(s.size).toBe(1);
    });
  });

  describe('apply mode=toggle', () => {
    it('flips membership per feature', () => {
      const s = new Selection();
      s.apply([A], 'replace');
      const diff = s.apply([A, B], 'toggle');
      expect(s.has(A)).toBe(false);
      expect(s.has(B)).toBe(true);
      expect(sortedKeys(diff.added)).toEqual([asKey(B)]);
      expect(sortedKeys(diff.removed)).toEqual([asKey(A)]);
    });
  });

  describe('remove', () => {
    it('removes only the listed refs', () => {
      const s = new Selection();
      s.apply([A, B, C], 'add');
      const diff = s.remove([A]);
      expect(s.size).toBe(2);
      expect(s.has(A)).toBe(false);
      expect(s.has(B)).toBe(true);
      expect(s.has(C)).toBe(true);
      expect(sortedKeys(diff.removed)).toEqual([asKey(A)]);
    });

    it('is a no-op for refs not in the selection', () => {
      const s = new Selection();
      s.apply([A], 'replace');
      const diff = s.remove([B]);
      expect(diff.changed).toBe(false);
      expect(s.size).toBe(1);
    });
  });

  describe('clear', () => {
    it('returns the prior contents in the diff', () => {
      const s = new Selection();
      s.apply([A, B, C], 'add');
      const diff = s.clear();
      expect(s.size).toBe(0);
      expect(diff.changed).toBe(true);
      expect(sortedKeys(diff.removed)).toEqual([asKey(A), asKey(B), asKey(C)]);
    });

    it('is a no-op (no change) when the selection is already empty', () => {
      const s = new Selection();
      const diff = s.clear();
      expect(diff.changed).toBe(false);
    });
  });

  describe('getByLayer', () => {
    it('returns ids for a single source/layer pair only', () => {
      const s = new Selection();
      s.apply([A, B, C, D], 'add');
      expect(s.getByLayer('s1', 'l1').sort()).toEqual([1, 2]);
      expect(s.getByLayer('s1', 'l2')).toEqual([1]);
      expect(s.getByLayer('s2', 'l1')).toEqual([99]);
      expect(s.getByLayer('s9', 'lx')).toEqual([]);
    });
  });

  describe('input deduplication', () => {
    it('deduplicates duplicate refs in a single apply call', () => {
      const s = new Selection();
      const diff = s.apply([A, A, A], 'add');
      expect(s.size).toBe(1);
      expect(diff.added).toHaveLength(1);
    });
  });

  describe('size accuracy across operations', () => {
    it('tracks size through add, remove, and toggle', () => {
      const s = new Selection();
      expect(s.size).toBe(0);
      s.apply([A, B], 'add');
      expect(s.size).toBe(2);
      s.apply([B, C], 'toggle'); // B removed, C added
      expect(s.size).toBe(2);
      s.remove([A]);
      expect(s.size).toBe(1);
      s.clear();
      expect(s.size).toBe(0);
    });
  });
});
