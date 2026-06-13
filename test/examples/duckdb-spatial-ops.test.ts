import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const html = readFileSync(resolve(__dirname, 'duckdb-spatial-ops.html'), 'utf8');

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
});
