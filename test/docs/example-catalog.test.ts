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
    }
  });

  it('defines exactly the Task 4 seed IDs and fixture associations', () => {
    expect(
      examples.map((example) => ({
        id: example.id,
        fixtures: [...example.fixtures],
      })),
    ).toEqual(expectedExamples);
  });

  it('keeps one static route HTML input for every seed example', async () => {
    const routeRoot = resolve(process.cwd(), 'packages/examples/examples');
    const routeFiles = await collectHtmlFiles(routeRoot);
    const expectedFiles = expectedExamples.map(({ id }) =>
      join('packages/examples/examples', id, 'index.html'),
    ).sort();

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
