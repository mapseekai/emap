import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
const repoRoot = process.cwd();
describe('example quality checkers', () => {
  it('parses seed and recipe calls from the exported examples catalog', async () => {
    const root = await fixtureRoot();
    await writeRecipesCatalog(root);
    await writeReflections(root, {
      children: [
        {
          name: 'Emap',
          variant: 'declaration',
          kind: 128,
          sources: [{ fileName: 'src/map.ts' }],
          comment: {
            summary: [{ kind: 'text', text: 'Map runtime.' }],
            blockTags: [{ tag: '@example', content: [{ kind: 'text', text: 'new Emap(opts)' }] }],
          },
        },
      ],
    });
    for (const id of ['feature-selection', 'seed-selection']) {
      await mkdir(join(root, 'packages/examples/examples', id), { recursive: true });
      await writeFile(
        join(root, 'packages/examples/examples', id, 'index.html'),
        '<script type="module" src="/src/main.ts"></script>',
      );
    }
    const result = runChecker('scripts/check-examples.mjs', root);
    expect(outputOf(result)).toContain('missing fixture missing.geojson');
    expect(outputOf(result)).toContain('missing fixture missing-seed.geojson');
    expect(outputOf(result)).toContain('missing API reflection MissingRecipeApi');
    expect(outputOf(result)).toContain('missing API reflection MissingSeedApi');
  });
  it('fails when a catalog item references a missing fixture', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['missing.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'Emap',
          variant: 'declaration',
          kind: 128,
          sources: [{ fileName: 'src/index.ts' }],
        },
      ],
    });
    await mkdir(join(root, 'packages/examples/examples/getting-started/fixture'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'packages/examples/examples/getting-started/fixture/index.html'),
      '<script type="module" src="/src/main.ts"></script>',
    );
    const result = runChecker('scripts/check-examples.mjs', root);
    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('missing.geojson');
  });
});
async function fixtureRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'emap-doc-checkers-'));
}
async function writeCatalog(
  root: string,
  values: {
    docs: string[];
    api: string[];
    fixtures: string[];
  },
): Promise<void> {
  const filePath = join(root, 'docs-meta/examples.ts');
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(
    filePath,
    `export const examples = [{
  id: 'getting-started/fixture',
  category: 'getting-started',
  title: { zh: '示例', en: 'Example' },
  docs: ${JSON.stringify(values.docs)},
  api: ${JSON.stringify(values.api)},
  fixtures: ${JSON.stringify(values.fixtures)},
  success: 'It works.',
  load: async () => {},
}];\n`,
  );
}
async function writeRecipesCatalog(root: string): Promise<void> {
  const filePath = join(root, 'docs-meta/examples.ts');
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(
    filePath,
    `const selectionDocs = '/docs/guides/selection';
export const examples = [
  seed('seed-selection', 'interaction', '种子', 'Seed', [selectionDocs, '/docs/missing-seed'], 'MissingSeedApi', 'missing-seed.geojson', 'It works.'),
  recipe('feature-selection', 'interaction', '选择', 'Selection', [selectionDocs, '/docs/missing-recipe'], 'MissingRecipeApi', ['selection'], ['missing.geojson']),
];
function seed(id, category, zh, en, docs, api, fixture, success) {
  return { id, category, title: { zh, en }, docs, api: [api], fixtures: [fixture], success };
}
function recipe(id, category, zh, en, docs, api, featureFlags, fixtures) {
  return { id, category, title: { zh, en }, docs, api: [api], featureFlags, fixtures };
}
`,
  );
}
async function writeReflections(root: string, value: unknown): Promise<void> {
  const filePath = join(root, 'dist/api/reflections.json');
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}
function runChecker(script: string, root: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [resolve(repoRoot, script), '--root', root], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}
function outputOf(result: ReturnType<typeof spawnSync>): string {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}
