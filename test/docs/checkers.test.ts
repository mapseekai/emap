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

  it('fails when docs front matter names an API without a real example association', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/reference/load-map.md', {
      id: 'reference/load-map',
      slug: '/reference/load-map',
      title: '加载地图',
      api: ['loadMap'],
      examples: [],
    });
    await writeCatalog(root, {
      docs: [],
      api: [],
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
    expect(outputOf(result)).toContain('loadMap: missing public API @example association');
  });

  it('fails the API checker on uncataloged public src reflections', async () => {
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

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('publicUtility');
    expect(outputOf(result)).toContain('uncataloged public API reflection');
  });

  it('does not treat nested reflection properties as standalone public APIs', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Options'],
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

  it('requires example associations for APIs cataloged only from docs front matter', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/reference/doc-only.md', {
      id: 'reference/doc-only',
      slug: '/reference/doc-only',
      title: '仅文档 API',
      api: ['docOnlyApi'],
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: [],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'docOnlyApi',
          variant: 'declaration',
          kind: 64,
          sources: [{ fileName: 'src/doc-only-api.ts' }],
          signatures: [
            {
              name: 'docOnlyApi',
              variant: 'signature',
              kind: 4096,
              sources: [{ fileName: 'src/doc-only-api.ts' }],
              parameters: [{ name: 'options', variant: 'param', kind: 32768 }],
            },
          ],
        },
      ],
    });

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('docOnlyApi: missing public API @example association');
  });

  it('parses seed and recipe calls from the exported examples catalog', async () => {
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
    expect(outputOf(result)).toContain('missing docs ID /docs/missing-recipe');
    expect(outputOf(result)).toContain('missing docs ID /docs/missing-seed');
    expect(outputOf(result)).toContain('missing API reflection MissingRecipeApi');
    expect(outputOf(result)).toContain('missing API reflection MissingSeedApi');
  });

  it('fails when generated module reflections or pages contain filler prose', async () => {
    const root = await fixtureRoot();
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: [],
      fixtures: ['inline:tiny.geojson'],
    });
    await writeReflections(root, {
      children: [
        {
          name: 'duckdb',
          variant: 'declaration',
          kind: 2,
          sources: [{ fileName: 'src/duckdb/index.ts' }],
          comment: {
            summary: [
              {
                kind: 'text',
                text: 'duckdb is a public emap API documented for package consumers.',
              },
            ],
          },
        },
      ],
    });
    await writeModulePage(
      root,
      'duckdb',
      '<p>duckdb is a public emap API documented for package consumers.</p>',
    );

    const result = runChecker('scripts/check-docs-api.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('module:duckdb: generated module filler prose');
    expect(outputOf(result)).toContain(
      'packages/docs/static/api/modules/duckdb.html: generated module filler prose',
    );
  });

  it('fails when an English mirror document has no front matter id', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
    });
    await writeDoc(root, 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md', {
      id: undefined,
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

  it('fails when either locale is missing required Task8 front matter fields', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
      api: undefined,
    });
    await writeDoc(root, 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md', {
      id: 'intro',
      slug: '/',
      title: 'Intro',
      examples: undefined,
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
    });

    const result = runChecker('scripts/check-docs-i18n.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain('missing Chinese api for intro');
    expect(outputOf(result)).toContain('missing English examples for intro');
  });

  it('fails when locale front matter parity differs', async () => {
    const root = await fixtureRoot();
    await writeDoc(root, 'packages/docs/docs/intro.md', {
      id: 'intro',
      slug: '/',
      title: '中文简介',
      api: ['Emap'],
    });
    await writeDoc(root, 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/intro.md', {
      id: 'intro',
      slug: '/',
      title: 'Intro',
      api: ['TopologySource'],
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
    });

    const result = runChecker('scripts/check-docs-i18n.mjs', root);

    expect(result.status).toBe(1);
    expect(outputOf(result)).toContain(
      'English api ["TopologySource"] does not match ["Emap"] for intro',
    );
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

  it('fails when an English document references an uncataloged example', async () => {
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
      examples: ['missing-example'],
    });
    await writeCatalog(root, {
      docs: ['/docs/'],
      api: ['Emap'],
      fixtures: ['inline:tiny.geojson'],
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
    expect(outputOf(result)).toContain('missing example catalog entry missing-example');
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
  frontMatter: {
    id?: string;
    slug?: string;
    title: string;
    api?: string[];
    examples?: string[];
    stability?: string;
    verifiedVersion?: string;
  },
  lineEnding = '\n',
): Promise<void> {
  const filePath = join(root, path);
  await mkdir(resolve(filePath, '..'), { recursive: true });
  const rel = path
    .replace(/^packages\/docs\/docs\//, '')
    .replace(/^packages\/docs\/i18n\/en\/docusaurus-plugin-content-docs\/current\//, '')
    .replace(/\.mdx?$/, '');
  const id = 'id' in frontMatter ? frontMatter.id : (rel.split('/').at(-1) ?? rel);
  const slug = 'slug' in frontMatter ? frontMatter.slug : `/${rel}`;
  const api = 'api' in frontMatter ? frontMatter.api : [];
  const examples = 'examples' in frontMatter ? frontMatter.examples : [];
  const stability = 'stability' in frontMatter ? frontMatter.stability : 'stable';
  const verifiedVersion = 'verifiedVersion' in frontMatter ? frontMatter.verifiedVersion : '0.5.0';
  const frontMatterLines = [
    id === undefined ? undefined : `id: ${id}`,
    slug === undefined ? undefined : `slug: ${slug}`,
    `title: ${frontMatter.title}`,
    api === undefined ? undefined : `api: ${JSON.stringify(api)}`,
    examples === undefined ? undefined : `examples: ${JSON.stringify(examples)}`,
    stability === undefined ? undefined : `stability: ${stability}`,
    verifiedVersion === undefined ? undefined : `verifiedVersion: ${verifiedVersion}`,
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
  const filePath = join(root, 'packages/docs/static/api/reflections.json');
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

async function writeModulePage(root: string, name: string, html: string): Promise<void> {
  const filePath = join(root, `packages/docs/static/api/modules/${name}.html`);
  await mkdir(resolve(filePath, '..'), { recursive: true });
  await writeFile(filePath, html);
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
