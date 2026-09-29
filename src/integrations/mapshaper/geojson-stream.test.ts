import { describe, expect, it, vi } from 'vitest';
import { GeoJSONFeatureFramer, importGeoJSONFileStream } from './geojson-stream';

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

it('rejects an oversized complete feature before parsing or delivering it', () => {
  let delivered = false;
  const framer = new GeoJSONFeatureFramer(() => {
    delivered = true;
  });
  const feature =
    '{"type":"Feature","properties":{"text":"' + 'x'.repeat(64 * 1024 ** 2) + '"},"geometry":null}';
  expect(() => framer.push('{"type":"FeatureCollection","features":[' + feature + ']}')).toThrow(
    RangeError,
  );
  expect(delivered).toBe(false);
});

it('preserves nested arrays, escaped quotes/backslashes, braces in strings and arbitrary chunk boundaries', () => {
  const features = Array.from({ length: 16 }, (_, i) => ({
    type: 'Feature',
    properties: {
      text: '\\'.repeat(i) + '"{}[]' + '终',
      nested: [{ key: '\\\\"}' }, [true, null, { a: 2 }]],
    },
    geometry: {
      type: 'LineString',
      coordinates: Array.from({ length: 100 }, (_, j) => [j * 0.1, -j, 9]),
    },
  }));
  const input = JSON.stringify({
    type: 'FeatureCollection',
    features,
    extra: { features: [1, 2] },
  });
  for (const width of [1, 2, 3, 5, 17, 256, input.length]) {
    const actual: unknown[] = [];
    const framer = new GeoJSONFeatureFramer((value) => actual.push(value));
    for (let i = 0; i < input.length; i += width) framer.push(input.slice(i, i + width));
    expect(framer.finish().extra).toEqual({ features: [1, 2] });
    expect(actual).toEqual(JSON.parse(input).features);
  }
});

it('leaves malformed feature JSON validation to JSON.parse without accepting missing delimiters', () => {
  for (const broken of [
    '{"type":"Feature","properties":[],"geometry":{"coordinates":[1,2}}',
    '{"type":"Feature" "geometry":null}',
    '{"type":"Feature","properties":{"x":"bad\\q"},"geometry":null}',
    '{"type":"Feature","properties":{"x":[[1,]]},"geometry":null}',
    '{"type":"Feature","properties":{\\"x":1},"geometry":null}',
  ])
    for (const width of [1, 7, 10000]) {
      const input = '{"type":"FeatureCollection","features":[' + broken + ']}';
      const framer = new GeoJSONFeatureFramer(() => {});
      expect(() => {
        for (let i = 0; i < input.length; i += width) framer.push(input.slice(i, i + width));
        framer.finish();
      }).toThrow();
    }
});

it('rejects string members and non-JSON whitespace instead of omitting them from the collection', () => {
  for (const content of ['"not-a-feature"', '""', '"ignored"{}', '\v', '\u00a0', '\f']) {
    const framer = new GeoJSONFeatureFramer(() => {});
    expect(() => {
      framer.push('{"type":"FeatureCollection","features":[' + content + ']}');
      framer.finish();
    }).toThrow(SyntaxError);
  }
});

it('streams split UTF-8 input through the real parser without changing properties or CRS metadata', async () => {
  const content = JSON.stringify({
    type: 'FeatureCollection',
    name: '中文图层',
    crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::6663' } },
    features: [
      {
        type: 'Feature',
        properties: { text: '转义\\"[]{}终' },
        geometry: { type: 'Point', coordinates: [-123.456, 789.123] },
      },
    ],
  });
  const bytes = new TextEncoder().encode(content);
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i === bytes.length) controller.close();
      else controller.enqueue(bytes.subarray(i, ++i));
    },
  });
  const file = new File([bytes], 'unicode.geojson');
  vi.spyOn(file, 'stream').mockReturnValue(stream);
  const progress = vi.fn();
  const result = await importGeoJSONFileStream(file, new AbortController().signal, progress);
  expect(result.info?.crs_string).toBe('urn:ogc:def:crs:EPSG::6663');
  expect(result.layers[0].shapes).toEqual([[[-123.456, 789.123]]]);
  expect(result.layers[0].data?.getRecords?.()[0]).toEqual({ text: '转义\\"[]{}终' });
  expect(progress).toHaveBeenLastCalledWith(bytes.length, 1);
  expect(stream.locked).toBe(false);
});

it('releases the stream after a UTF-8 decoding failure and respects cancellation at a progress yield', async () => {
  const malformed = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array([0xff]));
    },
  });
  const invalid = new File([''], 'invalid.geojson');
  vi.spyOn(invalid, 'stream').mockReturnValue(malformed);
  await expect(importGeoJSONFileStream(invalid, new AbortController().signal)).rejects.toThrow();
  expect(malformed.locked).toBe(false);
  const bytes = new TextEncoder().encode(
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { text: 'x'.repeat(4 * 1024 ** 2) },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    }),
  );
  const cancelled = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
    },
    cancel: cancelled,
  });
  const file = new File([bytes], 'cancel.geojson');
  vi.spyOn(file, 'stream').mockReturnValue(stream);
  const controller = new AbortController();
  await expect(
    importGeoJSONFileStream(file, controller.signal, () => controller.abort()),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(cancelled).toHaveBeenCalledOnce();
  expect(stream.locked).toBe(false);
});
