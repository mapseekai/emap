import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

interface TypeDocOutputConfig {
  name?: unknown;
  path?: unknown;
}

interface TypeDocConfig {
  entryPoints?: unknown;
  outputs?: unknown;
}

describe('TypeDoc public API config', () => {
  it('documents only public package entry points and emits html plus json', async () => {
    const config = JSON.parse(
      await readFile(resolve(process.cwd(), 'typedoc.json'), 'utf8'),
    ) as TypeDocConfig;

    expect(config.entryPoints).toEqual([
      'src/index.ts',
      'src/formats/index.ts',
      'src/duckdb/index.ts',
    ]);

    expect(config.outputs).toEqual([
      { name: 'html', path: 'packages/docs/static/api' },
      { name: 'json', path: 'packages/docs/static/api/reflections.json' },
    ] satisfies TypeDocOutputConfig[]);
  });
});
