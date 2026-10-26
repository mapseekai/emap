import { describe, expect, it } from 'vitest';
import {
  buildFixtureSource,
  loadFixtureBytes,
  loadFixtureDataset,
  loadFixtureText,
} from './fixtures';

describe('test-utils/fixtures', () => {
  it('loadFixtureText decodes UTF-8 and parses as JSON', () => {
    const bytes = loadFixtureBytes('tiny.geojson');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
    const txt = loadFixtureText('tiny.geojson');
    const obj = JSON.parse(txt);
    expect(obj.type).toBe('FeatureCollection');
    expect(obj.features).toHaveLength(3);
  });

  it('loadFixtureBytes rejects path traversal', () => {
    expect(() => loadFixtureBytes('../etc/passwd')).toThrow(/invalid name/);
    expect(() => loadFixtureBytes('/etc/passwd')).toThrow(/invalid name/);
  });

  it('loadFixtureDataset round-trips through real mapshaper', async () => {
    const ds = await loadFixtureDataset('tiny.geojson');
    expect(ds.layers).toHaveLength(1);
    expect(ds.layers[0].shapes).toHaveLength(3);
    expect(ds.layers[0].geometry_type).toBe('polygon');
  });

  it('buildFixtureSource resolves once data fires', async () => {
    const source = await buildFixtureSource('topology-shared.geojson', 'shared');
    expect(source.id).toBe('shared');
    expect(source.type).toBe('topology');
    const ds = source.getDataset();
    expect(ds?.layers[0].shapes).toHaveLength(3);
  });
});
