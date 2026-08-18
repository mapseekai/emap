import { examples } from '../../../docs-meta/examples';

export interface FixtureBinding {
  selector: string;
  paths: readonly string[];
}

const defaultSelector = '#file-input';
const fileSelectorIds = new Set([
  'duckdb-buffer',
  'duckdb-geoparquet-query',
  'duckdb-query',
  'duckdb-spatial-ops',
]);

function bindingsFor(id: string, fixtures: readonly string[]): readonly FixtureBinding[] {
  const filePaths = fixtures.filter((path) => !path.endsWith('.csv'));
  if (id === 'duckdb-overlay') {
    return [
      { selector: '#input-file', paths: filePaths.slice(0, 1) },
      { selector: '#mask-file', paths: filePaths.slice(1, 2) },
    ];
  }
  if (id === 'duckdb-spatial-aggregate-join') {
    return [
      { selector: '#target-file', paths: filePaths.slice(0, 1) },
      { selector: '#join-file', paths: filePaths.slice(1, 2) },
    ];
  }
  if (filePaths.length === 0) return [];
  return [
    {
      selector: fileSelectorIds.has(id) || id.startsWith('duckdb/geometry/') ? '#file' : defaultSelector,
      paths: filePaths,
    },
  ];
}

export const fixtureManifest: Readonly<
  Record<string, readonly FixtureBinding[]>
> = Object.fromEntries(
  examples.map((example) => [example.id, bindingsFor(example.id, example.fixtures)]),
);

export function fixtureUrl(path: string, baseUrl = import.meta.env.BASE_URL): string {
  const base = `/${baseUrl.replace(/^\/+|\/+$/g, '')}/`;
  return new URL(path.replace(/^\/+/, ''), `https://example.invalid${base}`).pathname;
}
