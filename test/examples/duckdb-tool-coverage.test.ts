import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { duckDbToolbox } from '../../src/duckdb/toolbox';

const examplesRoot = resolve(__dirname, '../../packages/examples/examples');
const runnerSource = readFileSync(
  resolve(__dirname, '../../packages/examples/src/duckdb-spatial-example.ts'),
  'utf8',
);

function collectExampleHtmls(dir: string, prefix = ''): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [id, html] of collectExampleHtmls(
        resolve(dir, entry.name),
        `${prefix}${entry.name}/`,
      )) {
        result.set(id, html);
      }
    } else if (entry.name === 'index.html') {
      result.set(prefix.replace(/\/$/, ''), readFileSync(resolve(dir, entry.name), 'utf8'));
    }
  }
  return result;
}

const exampleHtmls = collectExampleHtmls(examplesRoot);
const mountedOperations = new Set<string>();
for (const html of exampleHtmls.values()) {
  for (const match of html.matchAll(/operation:\s*'(\w+)'/g)) mountedOperations.add(match[1]!);
}

// Runner operations dispatched through the spatialRelation() branch instead of a `case`.
const relationBranchOperations: Record<string, true> = {
  intersects: true,
  contains: true,
  within: true,
  touches: true,
  disjoint: true,
  overlaps: true,
  equals: true,
  crosses: true,
  covers: true,
  coveredBy: true,
  containsProperly: true,
  distance: true,
  distanceWithin: true,
};

// toolId → runner operation id demonstrated by a workbench page.
const runnerOperations: Record<string, string> = {
  centroid: 'centroid',
  envelope: 'envelope',
  convexHull: 'convexHull',
  boundary: 'boundary',
  simplify: 'simplify',
  simplifyPreserveTopology: 'simplifyPreserveTopology',
  repairGeometry: 'repairGeometry',
  area: 'area',
  length: 'length',
  perimeter: 'perimeter',
  geometryType: 'geometryType',
  isValid: 'isValid',
  isEmpty: 'isEmpty',
  isSimple: 'isSimple',
  x: 'x',
  y: 'y',
  centroidX: 'centroidX',
  centroidY: 'centroidY',
  spatialRelation: 'intersects',
  densify: 'densify',
  multipartToSinglepart: 'multipartToSinglepart',
  extractVertices: 'extractVertices',
  pointToLine: 'pointToLine',
  lineToPolygon: 'lineToPolygon',
  polygonToLine: 'polygonToLine',
  near: 'near',
  nearest: 'nearest',
  spatialFilter: 'spatialFilter',
  spatialJoin: 'spatialJoin',
  attributeJoin: 'attributeJoin',
  dissolve: 'dissolve',
  collect: 'collect',
  merge: 'merge',
  append: 'append',
  reproject: 'reproject',
};

// toolId → [example id, call expression needle] for standalone pages.
const pageCalls: Record<string, readonly [string, string]> = {
  buffer: ['duckdb-buffer', 'buffer('],
  attributeFilter: ['duckdb-query', 'attributeFilter('],
  spatialSummaryJoin: ['duckdb-spatial-aggregate-join', 'spatialSummaryJoin('],
  intersect: ['duckdb-overlay', 'intersect('],
  difference: ['duckdb-overlay', 'difference('],
  clip: ['duckdb-overlay', 'clip('],
  union: ['duckdb-overlay', 'union('],
  symmetricDifference: ['duckdb-overlay', 'symmetricDifference('],
};

describe('DuckDB toolbox example coverage', () => {
  it('maps every toolbox tool to a runnable example action', () => {
    const uncovered: string[] = [];
    for (const tool of duckDbToolbox.tools) {
      const pageCall = pageCalls[tool.id];
      if (pageCall) {
        const [exampleId, needle] = pageCall;
        const html = exampleHtmls.get(exampleId);
        if (!html?.includes(needle))
          uncovered.push(`${tool.id} (${exampleId} missing '${needle}')`);
        continue;
      }
      const runnerOp = runnerOperations[tool.id];
      if (!runnerOp) {
        uncovered.push(`${tool.id} (no runner operation or page call mapped)`);
        continue;
      }
      if (!mountedOperations.has(runnerOp)) {
        uncovered.push(`${tool.id} (no example page mounts operation '${runnerOp}')`);
        continue;
      }
      const dispatched = relationBranchOperations[runnerOp]
        ? runnerSource.includes('spatialRelation(')
        : runnerSource.includes(`case '${runnerOp}':`);
      if (!dispatched)
        uncovered.push(`${tool.id} (runner does not execute operation '${runnerOp}')`);
    }
    expect(uncovered).toEqual([]);
  });

  it('demonstrates the duckDbToolbox registry entry point', () => {
    const html = exampleHtmls.get('duckdb-toolbox');
    expect(html, 'duckdb-toolbox example page is missing').toBeDefined();
    expect(html).toContain('duckDbToolbox.search(');
    expect(html).toContain('duckDbToolbox.execute(');
  });

  it('demonstrates the direct GeoParquet query helper', () => {
    const html = exampleHtmls.get('duckdb-geoparquet-query');
    expect(html, 'duckdb-geoparquet-query example page is missing').toBeDefined();
    expect(html).toContain('createDuckDbGeoParquetQuerySource(');
    expect(html).toContain('queryGeoParquetWithDuckDb(');
  });
});
