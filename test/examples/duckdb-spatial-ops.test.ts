import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(
  resolve(__dirname, '../../packages/examples/examples/duckdb-spatial-ops/index.html'),
  'utf8',
);
const duckDbBundle = readFileSync(resolve(__dirname, '../../dist/emap-duckdb.mjs'), 'utf8');

function importedDuckDbNames(): string[] {
  const importMatch = html.match(/import\s+\{([^}]+)\}\s+from\s+'@mapseekai\/emap\/duckdb'/);
  if (!importMatch) throw new Error('DuckDB module import not found');
  return importMatch[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => name.split(/\s+as\s+/)[0].trim());
}

function exportedDuckDbNames(): Set<string> {
  const exportMatches = [...duckDbBundle.matchAll(/export\s*\{([^}]+)\}/g)];
  const exportMatch = exportMatches.at(-1);
  if (!exportMatch) throw new Error('DuckDB module export list not found');
  return new Set(
    exportMatch[1]
      .split(',')
      .map(
        (name) =>
          name
            .trim()
            .split(/\s+as\s+/)
            .at(-1)
            ?.trim() ?? '',
      )
      .filter(Boolean),
  );
}

describe('duckdb-spatial-ops example', () => {
  it('defaults bundled GeoJSON input to WGS84', () => {
    expect(html).toContain('<input id="crs" type="text" value="EPSG:4326"');
  });

  it('re-registers the input source when the declared CRS changes', () => {
    expect(html).toContain("crsInput.addEventListener('change', reapplyInputCrs)");
    expect(html).not.toContain("crsInput.addEventListener('change', applyInputCrs)");
    expect(html).toContain('await map.addSource(SOURCE_ID, source);');
    expect(html).toContain('await source.setData(uploadedInput)');
    expect(html).toContain('crsInput.disabled = true');
  });

  it('discards operation results computed before an input CRS change', () => {
    expect(html.match(/map\.getSource\(SOURCE_ID\) !== runInputSource/g)).toHaveLength(2);
  });

  it('exposes DuckDB attribute operations in the operation picker', () => {
    expect(html).toContain('<option value="area">Area Attribute</option>');
    expect(html).toContain('<option value="geometryType">Geometry Type Attribute</option>');
    expect(html).toContain('<option value="y">Y Attribute</option>');
    expect(html).toContain('<option value="centroidX">Centroid X Attribute</option>');
    expect(html).toContain('<option value="centroidY">Centroid Y Attribute</option>');
  });

  it('supports click picking feature attributes', () => {
    expect(html).toContain('<pre id="picked-attributes"');
    expect(html).toContain('mapContainer.addEventListener');
    expect(html).toContain('map.queryFeatures(point');
    expect(html).toContain('JSON.stringify(features[0].properties, null, 2)');
  });

  it('lets one shared layer picker switch input and generated DuckDB layers', () => {
    expect(html).not.toContain('id="output-layer"');
    expect(html).toContain('populateLayerPicker(source');
    expect(html).toContain('sourceId: SOURCE_ID');
    expect(html).toContain('appendLayerPickerOptions(outputSource');
    expect(html).toContain('sourceId: OUTPUT_ID');
    expect(html).toContain('setCurrentLayerVisibility(targetSelect.value)');
    expect(html).toContain("targetSelect.addEventListener('change'");
    expect(html).toContain("visible ? 'visible' : 'none'");
  });

  it('exposes DuckDB relation operation controls', () => {
    expect(html).toContain('<option value="intersects">Intersects</option>');
    expect(html).toContain('<option value="contains">Contains</option>');
    expect(html).toContain('<option value="within">Within</option>');
    expect(html).toContain('<option value="touches">Touches</option>');
    expect(html).toContain('<option value="disjoint">Disjoint</option>');
    expect(html).toContain('<option value="distance">Distance</option>');
    expect(html).toContain('<option value="distanceWithin">Distance Within</option>');
  });

  it('exposes relation mode, mask layer, and distance controls', () => {
    expect(html).toContain('id="relation-mode"');
    expect(html).toContain('<option value="filter">Filter</option>');
    expect(html).toContain('<option value="attribute">Attribute</option>');
    expect(html).toContain('id="mask-layer"');
    expect(html).toContain('populateMaskLayerPicker()');
    expect(html).toContain('id="distance-label"');
    expect(html).toContain('id="distance"');
    expect(html).toContain('operationNeedsDistance(operationSelect.value)');
  });

  it('reads operation input from the currently registered map source', () => {
    const functionMatch = html.match(/function datasetForLayerEntry\(entry\) \{[\s\S]*?\n\s{6}\}/);
    if (!functionMatch) throw new Error('datasetForLayerEntry function not found');

    const currentInput = { crs: 'EPSG:3857' };
    const map = {
      getSource: () => ({
        getDataset: () => currentInput,
      }),
    };
    const createResolver = new Function(
      'map',
      `${functionMatch[0]}; return datasetForLayerEntry;`,
    ) as (map: object) => (entry: { sourceId: string }) => object | null;
    const resolveDataset = createResolver(map);

    expect(resolveDataset({ sourceId: 'input' })).toBe(currentInput);
  });

  it('registers generated output through map CRS normalization', () => {
    expect(html).toContain('outputSource.setDataset(result)');
    expect(html).toContain('await map.addSource(OUTPUT_ID, outputSource)');
    expect(html).not.toContain('function createOutputSource');
    expect(html).not.toContain('await outputSource.reproject');
  });

  it('imports only exported DuckDB browser module names', () => {
    const exported = exportedDuckDbNames();
    for (const importedName of importedDuckDbNames()) {
      expect(exported.has(importedName), `${importedName} is not exported by emap-duckdb.mjs`).toBe(
        true,
      );
    }
  });

  it('uses the exported relation runner and distance input for relation operations', () => {
    expect(html).toContain('runRelationOperation as runDuckDbRelationOperation');
    expect(html).toContain('runDuckDbRelationOperation(inputDataset, maskDataset');
    expect(html).toContain('const distance = Number(distanceInput.value)');
    expect(html).toContain('runRelationOperation(');
    expect(html).toContain('maskDataset');
  });

  it('keeps relation output in the shared picker and click picking wired', () => {
    expect(html).toContain('appendLayerPickerOptions(outputSource');
    expect(html).toContain('sourceId: OUTPUT_ID');
    expect(html).toContain('populateMaskLayerPicker()');
    expect(html).toContain('picked-attributes');
    expect(html).toContain('map.queryFeatures(point');
    expect(html).toContain('renderPickedAttributes(features)');
  });
});
