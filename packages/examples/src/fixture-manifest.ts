import { examples } from '../../../docs-meta/examples';

export interface FixtureBinding {
  selector: string;
  paths: readonly string[];
}

const defaultSelector = '#file-input';
const fileSelectorIds: Record<string, true> = {
  'duckdb-buffer': true,
  'duckdb-geoparquet-query': true,
  'duckdb-query': true,
};

function splitTwoInputs(inputSelector: string, maskSelector: string, filePaths: readonly string[]): readonly FixtureBinding[] {
  return [
    { selector: inputSelector, paths: filePaths.slice(0, 1) },
    { selector: maskSelector, paths: filePaths.slice(1, 2) },
  ];
}

function bindingsFor(id: string, fixtures: readonly string[]): readonly FixtureBinding[] {
  const filePaths = fixtures.filter((path) => !path.endsWith('.csv'));
  if (id === 'duckdb-overlay' || id === 'duckdb-toolbox') {
    return splitTwoInputs('#input-file', '#mask-file', filePaths);
  }
  if (id === 'duckdb-spatial-aggregate-join') {
    return splitTwoInputs('#target-file', '#join-file', filePaths);
  }
  if (id.startsWith('duckdb/')) {
    if (filePaths.length > 1) return splitTwoInputs('#file', '#mask-file', filePaths);
    return filePaths.length > 0 ? [{ selector: '#file', paths: filePaths }] : [];
  }
  if (filePaths.length === 0) return [];
  return [
    {
      selector: fileSelectorIds[id] ? '#file' : defaultSelector,
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
