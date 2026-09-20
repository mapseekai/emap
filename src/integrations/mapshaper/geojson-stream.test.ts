import { describe, expect, it } from 'vitest';
import { GeoJSONFeatureFramer } from './geojson-stream';

describe('streaming FeatureCollection framing', () => {
  const source =
    '{"type":"FeatureCollection","name":"本地","features":[{"type":"Feature","properties":{"text":"quote \\" and [brace] }"},"geometry":null},{"type":"Feature","properties":{},"geometry":{"type":"Point","coordinates":[119.5,30.2]}}],"crs":{"properties":{"name":"EPSG:4326"}}}';
  it('frames real JSON syntax across every character boundary without a whole-file object', () => {
    const expected = JSON.parse(source);
    for (const width of [1, 2, 7, 64, source.length]) {
      const found: unknown[] = [],
        framer = new GeoJSONFeatureFramer((v) => found.push(v));
      for (let i = 0; i < source.length; i += width) framer.push(source.slice(i, i + width));
      const metadata = framer.finish();
      expect(found).toEqual(expected.features);
      expect(metadata.crs).toEqual(expected.crs);
      expect(metadata.features).toEqual([]);
    }
  });
  it('does not mistake a quoted features key or nested array in metadata for the feature array', () => {
    const found: unknown[] = [],
      framer = new GeoJSONFeatureFramer((v) => found.push(v));
    framer.push('{"type":"FeatureCollection","nested":{"features":[1,2]},"features":[]}');
    expect(framer.finish().nested).toEqual({ features: [1, 2] });
    expect(found).toEqual([]);
  });
  it('rejects truncation, malformed separators and a non-Feature member', () => {
    for (const value of [
      '{"type":"FeatureCollection","features":[',
      '{"type":"FeatureCollection","features":[,]}',
      '{"type":"FeatureCollection","features":[{}]}',
    ]) {
      const framer = new GeoJSONFeatureFramer(() => {});
      expect(() => {
        framer.push(value);
        framer.finish();
      }).toThrow();
    }
  });
  it('accepts UTF-8 BOM and escaped JSON property names', () => {
    const framer = new GeoJSONFeatureFramer(() => {});
    framer.push('\uFEFF{"type":"FeatureCollection","\\u0066eatures":[]}');
    expect(framer.finish().type).toBe('FeatureCollection');
  });
});
