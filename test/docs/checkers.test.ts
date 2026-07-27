import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

describe('documentation quality checkers', () => {
  it('fails when an English mirror document is missing', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
    });

    const result = runChecker('scripts/check-docs-i18n.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain(
      'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md',
    );
    expect(outputOf(result)).toContain('intro');
  });

  it('fails when a documented TypeDoc parameter lacks comment text', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['loadMap'],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'loadMap',
          variant: 'declaration',
          kind: 64,
          sources: [{ fileName: 'src/index.ts' }],
          signatures: [
            {
              name: 'loadMap',
              variant: 'signature',
              kind: 4096,
              sources: [{ fileName: 'src/index.ts' }],
              comment: {
                summary: [{ kind: 'text', text: 'Loads a map.' }],
                blockTags: [
                  { tag: '@example', content: [{ kind: 'text', text: 'getting-started/fixture' }] },
                ],
              },
              parameters: [{ name: 'options', variant: 'param', kind: 32768 }],
            },
          ],
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('loadMap.options');
  });

  it('fails when a public TypeDoc reflection lacks an @example tag', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['loadMap'],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'loadMap',
          variant: 'declaration',
          kind: 64,
          sources: [{ fileName: 'src/index.ts' }],
          comment: {
            summary: [{ kind: 'text', text: 'Loads a map.' }],
          },
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('loadMap');
    expect(outputOf(result)).toContain('@example');
  });

  it('does not fail the staged API checker on uncataloged public src reflections', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: [],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'publicUtility',
          variant: 'declaration',
          kind: 64,
          sources: [{ fileName: 'src/public-utility.ts' }],
          comment: {
            summary: [{ kind: 'text', text: 'Formats public utility output.' }],
          },
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(0);
  });

  it('does not treat nested reflection properties as standalone public APIs', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: [],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'Options',
          variant: 'declaration',
          kind: 256,
          sources: [{ fileName: 'src/options.ts' }],
          comment: {
            summary: [{ kind: 'text', text: 'Configures the runtime.' }],
            blockTags: [
              { tag: '@example', content: [{ kind: 'text', text: 'const options = {};' }] },
            ],
          },
          children: [
            {
              name: 'value',
              variant: 'declaration',
              kind: 1024,
              sources: [{ fileName: 'src/options.ts' }],
            },
          ],
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(0);
  });

  it('parses recipe catalog entries with explicit docs, API, and fixture metadata', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/guides/selection.md', {
      id: 'guides/selection',
      slug: '/guides/selection',
      title: '选择',
    });
    await writeDoc(
      root,
      'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/guides/selection.md',
      {
        id: 'guides/selection',
        slug: '/guides/selection',
        title: 'Selection',
      },
    );
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
    await mkdir(join(root, 'packages/examples/examples/feature-selection'), {
      recursive: true,
    });
    await writeFile(
      join(root, 'packages/examples/examples/feature-selection/index.html'),
      '<script type="module" src="/src/main.ts"></script>',
    );

    const result = runChecker('scripts/check-examples.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('missing fixture missing.geojson');
  });

  it('fails when @example is the only public TypeDoc comment prose', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['loadMap'],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'loadMap',
          variant: 'declaration',
          kind: 64,
          sources: [{ fileName: 'src/index.ts' }],
          comment: {
            blockTags: [
              { tag: '@example', content: [{ kind: 'text', text: 'getting-started/fixture' }] },
            ],
          },
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('loadMap');
    expect(outputOf(result)).toContain('missing public API comment text');
  });

  it('fails when an English mirror document has no front matter id', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
    });
    await writeDoc(root, 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md', {
      slug: '/',
      title: 'Intro',
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
    });

    const result = runChecker('scripts/check-docs-i18n.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('missing English id for intro');
  });

  it('parses CRLF Markdown front matter', async () => {
    const root = await fixtureRoot();
    await writeDoc(
      root,
      'packages/docs/docs/intro.md',
      {
        id: 'intro',
        slug: '/',
        title: '中文简介',
      },
      '\r\n',
    );
    await writeDoc(
      root,
      'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md',
      {
        id: 'intro',
        slug: '/',
        title: 'Intro',
      },
      '\r\n',
    );
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
    });

    const result = runChecker('scripts/check-docs-i18n.mjs', root);

    expect(result.status).toBe(0);
  });

  it('fails when a catalog item references a missing fixture', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
    });
    await writeDoc(root, 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md', {
      id: 'intro',
      slug: '/',
      title: 'Intro',
    });
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

async function writeDoc(
  root: string,
  path: string,
  frontMatter: { id?: string; slug: string; title: string },
  lineEnding = '\n',
): Promise<void> {
  const filePath = join(root, path);
  await mkdir(resolve(filePath, '..'), { recursive: true });
  const frontMatterLines = [
    frontMatter.id === undefined ? undefined : `id: ${frontMatter.id}`,
    `slug: ${frontMatter.slug}`,
    `title: ${frontMatter.title}`,
  ].filter((line): line is string => line !== undefined);
  await writeFile(
    filePath,
    ['---', ...frontMatterLines, '---', '', `# ${frontMatter.title}`, ''].join(lineEnding),
  );
}

async function writeCatalog(
  root: string,
  values: { docs: string[]; api: string[]; fixtures: string[] },
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
const recipes = [
  recipe('feature-selection', 'interaction', '选择', 'Selection', [selectionDocs], 'Emap', ['selection'], ['missing.geojson'], 'select-source', async () => {}),
];
function recipe(id, category, zh, en, docs, api, featureFlags, fixtures, sourceId, load) {
  return { id, category, title: { zh, en }, docs, api: [api], featureFlags, fixtures, sourceId, load };
}
`,
  );
}

async function writeReflections(root: string, value: unknown): Promise<void> {
  const filePath = join(root, 'packages/docs/static/api/reflections.json');
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
