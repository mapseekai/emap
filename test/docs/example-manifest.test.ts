import { describe, expect, it } from 'vitest';
import { exampleIds, examples } from '../../docs-meta/examples';

describe('example manifest ownership', () => {
  it('keeps example ids unique and derived from the manifest', () => {
    expect(exampleIds).toEqual(examples.map(({ id }) => id));
    expect(new Set(exampleIds).size).toBe(exampleIds.length);
  });
});
