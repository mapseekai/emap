import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleIds, examples } from '../../docs-meta/examples';

const root = resolve(import.meta.dirname, '../..');

describe('example manifest ownership', () => {
  it('keeps example ids unique and derived from the manifest', () => {
    expect(exampleIds).toEqual(examples.map(({ id }) => id));
    expect(new Set(exampleIds).size).toBe(exampleIds.length);
  });

  it('derives Vite build inputs from docs-meta/examples.ts', () => {
    const config = readFileSync(resolve(root, 'packages/examples/vite.config.ts'), 'utf8');
    expect(config).toContain("import { exampleIds } from '../../docs-meta/examples';");
    expect(config).toContain('const routeIds = exampleIds;');
  });
});
