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

const task6Fixture = 'fixtures/task-6-polygons.geojson';
const task6CsvFixture = 'fixtures/task-6-join.csv';
const task6MergeFixture = 'fixtures/task-6-polygons-alt.geojson';

const task6Matrix = [
  [
    'attribute-editing',
    [task6Fixture],
    ['loadAttributeEditing', 'addField', 'removeField', 'renameField', 'setFeatureProperty'],
  ],
  [
    'attribute-expressions',
    [task6Fixture],
    ['loadAttributeExpressions', 'applyExpression', 'Expression', 'Where'],
  ],
  [
    'data-engineering',
    [task6Fixture],
    ['loadDataEngineering', 'sortFeatures', 'uniqueFeatures', 'filterFields', 'renameFields'],
  ],
  [
    'feature-attributes',
    [task6Fixture],
    ['loadFeatureAttributes', 'queryFeatures', 'setHighlightedFeatures'],
  ],
  ['filter-features', [task6Fixture], ['loadFilterFeatures', 'filterFeatures', 'Expression']],
  [
    'geoparquet-viewer',
    [],
    [
      'loadGeoParquetViewer',
      'initParquetWasm',
      '.parquet,.geoparquet,.arrow,.arrows,.feather',
      'geoarrow',
    ],
  ],
  [
    'export-geoparquet',
    [task6Fixture],
    ['loadExportGeoparquet', 'geoparquet-native', 'geoarrow', 'downloadBlob'],
  ],
  ['export-roundtrip', [task6Fixture], ['loadExportRoundtrip', 'DrawFeatureControl', 'export']],
  [
    'join',
    [task6Fixture, task6CsvFixture],
    ['loadJoin', 'joinTable', 'Target key', 'Source key', 'joined_'],
  ],
  [
    'merge-layers',
    [task6Fixture, task6MergeFixture],
    ['loadMergeLayers', 'multiple: true', 'force', 'flatten', 'mergeLayers'],
  ],
  ['merge-selected', [task6Fixture], ['loadMergeSelected', 'mergeSelected', 'Clear selection']],
  ['rename-layer', [task6Fixture], ['loadRenameLayer', 'renameLayer', 'New layer name']],
  ['split-layer', [task6Fixture], ['loadSplitLayer', 'splitLayer', 'Split field']],
  ['interaction-handlers', [task6Fixture], ['loadInteractionHandlers', 'dragPan', 'scrollZoom']],
  [
    'feature-selection',
    [task6Fixture],
    ['loadFeatureSelection', 'selectionchange', 'shiftKey', 'toggle'],
  ],
  ['box-select', [task6Fixture], ['loadBoxSelect', 'BoxSelectControl', 'Delete selected']],
  ['lasso-select', [task6Fixture], ['loadLassoSelect', 'LassoSelectControl', 'BoxSelectControl']],
  ['china-editing', [task6Fixture], ['loadChinaEditing', 'EditToolbar', 'VertexEditControl']],
  [
    'draw-snap-clear',
    [task6Fixture],
    ['loadDrawSnapClear', 'drawFeature.setOptions', 'snapToVertex', 'snapToEdge'],
  ],
  [
    'draw-snap-edge',
    [task6Fixture],
    ['loadDrawSnapEdge', 'DrawFeatureControl', 'snapToVertex', 'snapToEdge'],
  ],
  [
    'feature-rotate-scale',
    [task6Fixture],
    ['loadFeatureRotateScale', 'beginAffineSession', 'rotateMatrix', 'scaleMatrix'],
  ],
  [
    'feature-translate',
    [task6Fixture],
    ['loadFeatureTranslate', 'beginTranslateSession', 'move(0.01, 0)'],
  ],
  ['snapshot', [task6Fixture], ['loadSnapshot', 'exportSnapshot']],
  ['transaction', [task6Fixture], ['loadTransaction', 'beginTransaction', 'commit', 'rollback']],
  ['undo-redo', [task6Fixture], ['loadUndoRedo', 'HistoryControl', 'undo', 'redo']],
  ['vertex-editing', [task6Fixture], ['loadVertexEditing', 'VertexEditControl', 'EditToolbar']],
] as const satisfies readonly (readonly [string, readonly string[], readonly string[]])[];

const task6ControlMatrix = {
  history: [
    'attribute-editing',
    'attribute-expressions',
    'data-engineering',
    'filter-features',
    'join',
    'merge-layers',
    'merge-selected',
    'rename-layer',
    'split-layer',
    'feature-selection',
    'box-select',
    'lasso-select',
    'draw-snap-clear',
    'draw-snap-edge',
    'feature-rotate-scale',
    'feature-translate',
    'transaction',
    'undo-redo',
  ],
  basemap: [
    'feature-attributes',
    'geoparquet-viewer',
    'export-geoparquet',
    'china-editing',
    'vertex-editing',
  ],
} as const;

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

  it('covers every Task 6 original HTML migration with declared fixtures and loader markers', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');

    for (const [id, fixtures, loaderMarkers] of task6Matrix) {
      const example = byId.get(id);
      expect(example, `${id} is missing from the catalog`).toBeDefined();
      expect(
        examples.filter((item) => item.id === id),
        `${id} duplicates`,
      ).toHaveLength(1);
      expect(example?.source.html).toBe(`test/examples/${id}.html`);
      expect(example?.fixtures, `${id} declared fixtures`).toEqual(fixtures);

      const originalHtml = await readFile(
        resolve(process.cwd(), `test/examples/${id}.html`),
        'utf8',
      );
      expect(originalHtml, `${id} original HTML has map surface`).toContain('id="map"');

      for (const fixture of fixtures) {
        await readFile(resolve(process.cwd(), 'packages/examples/public', fixture), 'utf8');
      }

      for (const marker of loaderMarkers) {
        expect(catalogSource, `${id} missing migrated marker ${marker}`).toContain(marker);
      }
    }
  });

  it('declares only fixtures that the migrated Task 6 loaders fetch', () => {
    const task6Ids: ReadonlySet<string> = new Set(task6Matrix.map(([id]) => id));

    for (const example of examples.filter((item) => task6Ids.has(item.id))) {
      if (example.id === 'geoparquet-viewer') {
        expect(example.fixtures, `${example.id} waits for user parquet/arrow uploads`).toEqual([]);
        continue;
      }
      expect(example.fixtures, `${example.id} has a fixture-backed runtime`).toContain(
        task6Fixture,
      );
      if (example.id === 'join') {
        expect(example.fixtures).toContain(task6CsvFixture);
      } else {
        expect(example.fixtures, `${example.id} must not fetch join CSV`).not.toContain(
          task6CsvFixture,
        );
      }
      if (example.id === 'merge-layers') {
        expect(example.fixtures).toContain(task6MergeFixture);
      } else {
        expect(example.fixtures, `${example.id} must not fetch merge-only fixture`).not.toContain(
          task6MergeFixture,
        );
      }
    }
  });

  it('preserves representative Task 6 behavior families', async () => {
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');

    expect(extractFunction(catalogSource, 'setupGeoParquetViewer')).toEqual(
      expect.stringContaining('initFormats'),
    );
    expect(extractFunction(catalogSource, 'initFormats')).toEqual(
      expect.stringContaining('initParquetWasm'),
    );
    expect(extractFunction(catalogSource, 'setupGeoParquetViewer')).toEqual(
      expect.stringContaining('.parquet,.geoparquet,.arrow,.arrows,.feather'),
    );
    expect(extractFunction(catalogSource, 'setupMergeLayers')).toEqual(
      expect.stringContaining('multiple: true'),
    );
    expect(extractFunction(catalogSource, 'setupMergeLayers')).toEqual(
      expect.stringContaining('flatten.checked'),
    );
    expect(extractFunction(catalogSource, 'setupAttributeEditing')).toEqual(
      expect.stringContaining('attribute-row'),
    );
    expect(extractFunction(catalogSource, 'setupAttributeEditing')).toEqual(
      expect.stringContaining('setFeatureProperty'),
    );
    expect(extractFunction(catalogSource, 'clickToSelect')).toEqual(
      expect.stringContaining('shiftKey'),
    );
    expect(extractFunction(catalogSource, 'clickToSelect')).toEqual(
      expect.stringContaining('toggle'),
    );
  });

  it('preserves Task 6 control families through catalog feature flags', async () => {
    const byId = new Map(examples.map((example) => [example.id, example]));
    const catalogSource = await readFile(resolve(process.cwd(), 'docs-meta/examples.ts'), 'utf8');
    const createRuntime = extractFunction(catalogSource, 'createRuntime');

    expect(createRuntime).toEqual(expect.stringContaining('new HistoryControl'));
    expect(createRuntime).toEqual(expect.stringContaining('bindHistoryShortcuts'));
    expect(createRuntime).toEqual(expect.stringContaining('new BasemapControl'));
    expect(createRuntime).toEqual(expect.stringContaining('new StatusControl'));

    for (const id of task6ControlMatrix.history) {
      expect(byId.get(id)?.featureFlags, `${id} history controls`).toContain('history');
    }
    for (const id of task6ControlMatrix.basemap) {
      expect(byId.get(id)?.featureFlags, `${id} basemap/status controls`).toContain('basemap');
    }
    for (const id of ['geoparquet-viewer', 'export-geoparquet']) {
      expect(byId.get(id)?.featureFlags, `${id} format status control`).toContain('formats');
    }
  });

  it('keeps one static route HTML input and Vite route ID for every catalog example', async () => {
    const routeRoot = resolve(process.cwd(), 'packages/examples/examples');
    const routeFiles = await collectHtmlFiles(routeRoot);
    const expectedFiles = examples
      .map(({ id }) => join('packages/examples/examples', id, 'index.html'))
      .sort();
    const viteConfig = await readFile(
      resolve(process.cwd(), 'packages/examples/vite.config.ts'),
      'utf8',
    );

    expect(routeFiles).toEqual(expectedFiles);

    for (const file of routeFiles) {
      const html = await readFile(resolve(process.cwd(), file), 'utf8');
      expect(html).toContain('src="/src/main.ts"');
    }

    for (const example of examples) {
      expect(viteConfig, `${example.id} missing from Vite routeIds`).toContain(`'${example.id}'`);
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

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`function ${name}`);
  expect(start, `${name} start`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nfunction ', start + 1);
  return next === -1 ? source.slice(start) : source.slice(start, next);
}
