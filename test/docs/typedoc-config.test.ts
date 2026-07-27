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

interface ReflectionNode {
  name?: unknown;
  children?: unknown;
  signatures?: unknown;
}

const INTERNAL_HOST_SURFACES = [
  '_activeTransaction',
  '_allowExpressionEvaluation',
  '_clearSpatialIndexesForSources',
  '_fireHistoryChange',
  '_fireSelectionChange',
  '_history',
  '_invalidateShapeCachesForSources',
  '_removed',
  '_resolveLayer',
  '_scheduleRender',
  '_selection',
  '_sources',
  '_validators',
  '_workerMode',
  '_workerPool',
  '_workerRouting',
  '_workerThreshold',
];

function isReflectionNode(value: unknown): value is ReflectionNode {
  return typeof value === 'object' && value !== null;
}

function collectReflectionNames(value: unknown, names = new Set<string>()): Set<string> {
  if (!isReflectionNode(value)) return names;

  if (typeof value.name === 'string') names.add(value.name);

  for (const child of Array.isArray(value.children) ? value.children : []) {
    collectReflectionNames(child, names);
  }
  for (const signature of Array.isArray(value.signatures) ? value.signatures : []) {
    collectReflectionNames(signature, names);
  }

  return names;
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

  it('omits internal host surfaces from generated reflections', async () => {
    const reflections = JSON.parse(
      await readFile(resolve(process.cwd(), 'packages/docs/static/api/reflections.json'), 'utf8'),
    ) as unknown;

    const names = collectReflectionNames(reflections);

    for (const internalName of INTERNAL_HOST_SURFACES) {
      expect(names.has(internalName)).toBe(false);
    }
  });

  it('omits internal host surfaces from generated Emap HTML', async () => {
    const html = await readFile(
      resolve(process.cwd(), 'packages/docs/static/api/classes/index.Emap.html'),
      'utf8',
    );

    for (const internalName of INTERNAL_HOST_SURFACES) {
      expect(html).not.toContain(internalName);
    }
  });
});
