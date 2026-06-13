import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, 'duckdb-spatial-ops.html'), 'utf8');
const duckDbBundle = readFileSync(resolve(__dirname, '../../dist/emap-duckdb.mjs'), 'utf8');

function importedDuckDbNames(): string[] {
  const importMatch = html.match(
    /import\s+\{([\s\S]*?)\}\s+from\s+'..\/..\/dist\/emap-duckdb\.mjs'/,
  );
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
