import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';

const root = resolve(import.meta.dirname, '../..');

describe('example manifest ownership', () => {
  it('keeps example ids unique', () => {
    const ids = examples.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('derives Vite build inputs from docs-meta/examples.ts', () => {
    const config = readFileSync(resolve(root, 'packages/examples/vite.config.ts'), 'utf8');
    expect(config).toContain("from '../../docs-meta/examples'");
    expect(config).toMatch(/examples\.map\(\(example\) => example\.id\)/);
  });
});
