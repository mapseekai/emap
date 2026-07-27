import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { examples } from '../../docs-meta/examples';
import { resolveExampleId } from '../../packages/examples/src/example-page';

const expectedExamples = [
  {
    id: 'getting-started/geojson-viewer',
    fixtures: ['inline:geojson-viewer.geojson'],
  },
  {
    id: 'getting-started/points',
    fixtures: ['inline:points.geojson'],
  },
  {
    id: 'getting-started/lines',
    fixtures: ['inline:lines.geojson'],
  },
  {
    id: 'getting-started/polygons',
    fixtures: ['inline:polygons.geojson'],
  },
  {
    id: 'getting-started/polygon-fill',
    fixtures: ['inline:polygon-fill.geojson'],
  },
] as const;

const task6Examples = [
  'attribute-editing',
  'attribute-expressions',
  'data-engineering',
  'feature-attributes',
  'filter-features',
  'geoparquet-viewer',
  'export-geoparquet',
  'export-roundtrip',
  'join',
  'merge-layers',
  'merge-selected',
  'rename-layer',
  'split-layer',
  'interaction-handlers',
  'feature-selection',
  'box-select',
  'lasso-select',
  'china-editing',
  'draw-snap-clear',
  'draw-snap-edge',
  'feature-rotate-scale',
  'feature-translate',
  'snapshot',
  'transaction',
  'undo-redo',
  'vertex-editing',
] as const;

describe('example catalog metadata', () => {
  it('defines unique, complete runnable example entries', () => {
    const ids = new Set<string>();

    for (const example of examples) {
      expect(ids.has(example.id), `${example.id} is duplicated`).toBe(false);
      ids.add(example.id);

      expect(example.title.zh.trim(), `${example.id} is missing zh title`).not.toBe('');
      expect(example.title.en.trim(), `${example.id} is missing en title`).not.toBe('');
      expect(example.docs, `${example.id} docs`).toHaveLength(1);
      expect(example.api, `${example.id} api`).toHaveLength(1);
      expect(example.success.trim(), `${example.id} success`).not.toBe('');
      expect(example.description.zh.trim(), `${example.id} is missing zh description`).not.toBe('');
      expect(example.description.en.trim(), `${example.id} is missing en description`).not.toBe('');
      expect(example.learningGoals.zh, `${example.id} zh learning goals`).not.toHaveLength(0);
      expect(example.learningGoals.en, `${example.id} en learning goals`).not.toHaveLength(0);
      expect(example.tags, `${example.id} tags`).not.toHaveLength(0);
      expect(example.featureFlags, `${example.id} feature flags`).toBeDefined();
      expect(example.route).toBe(`/examples/${example.id}/`);
      expect(example.load, `${example.id} load module`).toEqual(expect.any(Function));
    }
  });

  it('preserves the Task 4 seed IDs and fixture associations', () => {
    expect(
      expectedExamples.map(({ id }) => {
        const example = examples.find((item) => item.id === id);
        return {
          id: example?.id,
          fixtures: [...(example?.fixtures ?? [])],
        };
      }),
    ).toEqual(expectedExamples);
  });

  it('migrates the Task 6 original HTML examples with fixture-backed loaders', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));

    for (const id of task6Examples) {
      const example = byId.get(id);
      expect(example, `${id} is missing from the catalog`).toBeDefined();
      expect(
        examples.filter((item) => item.id === id),
        `${id} duplicates`,
      ).toHaveLength(1);
      expect(example?.source.html).toBe(`test/examples/${id}.html`);
      expect(example?.fixtures.length, `${id} fixtures`).toBeGreaterThan(0);

      for (const fixture of example?.fixtures ?? []) {
        expect(fixture.startsWith('inline:'), `${id} must use static fixtures`).toBe(false);
        await readFile(resolve(process.cwd(), 'packages/examples/public', fixture), 'utf8');
      }
    }
  });

  it('keeps one static route HTML input for every catalog example', async () => {
    const routeRoot = resolve(process.cwd(), 'packages/examples/examples');
    const routeFiles = await collectHtmlFiles(routeRoot);
    const expectedFiles = examples
      .map(({ id }) => join('packages/examples/examples', id, 'index.html'))
      .sort();

    expect(routeFiles).toEqual(expectedFiles);

    for (const file of routeFiles) {
      const html = await readFile(resolve(process.cwd(), file), 'utf8');
      expect(html).toContain('src="/src/main.ts"');
    }
  });

  it('normalizes direct static route paths to catalog IDs', () => {
    expect(exampleIdForPath('/examples/getting-started/points')).toBe('getting-started/points');
    expect(exampleIdForPath('/examples/getting-started/points/')).toBe('getting-started/points');
    expect(exampleIdForPath('/examples/getting-started/points/index.html')).toBe(
      'getting-started/points',
    );
    expect(exampleIdForPath('/examples/attribute-editing/index.html')).toBe('attribute-editing');
  });
});

async function collectHtmlFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return collectHtmlFiles(path);
      if (entry.isFile() && entry.name === 'index.html') {
        return [relative(process.cwd(), path)];
      }
      return [];
    }),
  );
  return files.flat().sort();
}

function exampleIdForPath(pathname: string): string | null {
  return resolveExampleId({
    hash: '',
    pathname,
  } as Location);
}
