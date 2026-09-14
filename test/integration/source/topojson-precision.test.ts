import { describe, expect, it } from 'vitest';
import { TopologySource } from '../../../src/domain/source/topology-source';
import { projectLayer } from '../../../src/engine/map/ops/project';
import type { OpContext } from '../../../src/engine/map/ops/_context';

// Irregular, non-grid-aligned coordinates catch lossy serialization that simple
// rectangles and integer-only fixtures cannot expose.
const ring = [
  [116.123456789012, 39.234567890123],
  [117.987654321098, 39.345678901234],
  [117.456789012345, 40.876543210987],
  [116.234567890123, 40.765432109876],
  [116.123456789012, 39.234567890123],
];
const coordinates = [ring];
const input = new TextEncoder().encode(
  JSON.stringify({
    type: 'Feature',
    properties: { name: 'precision' },
    geometry: { type: 'Polygon', coordinates },
  }),
);

async function load(filename: string, bytes: Uint8Array): Promise<TopologySource> {
  const source = new TopologySource('s');
  await source.setData({ filename, content: bytes });
  return source;
}

async function roundtrip(source: TopologySource): Promise<TopologySource> {
  const blob = await source.export({ format: 'topojson' });
  return load('stored.topojson', new Uint8Array(await blob.arrayBuffer()));
}

async function expectOriginalCoordinates(source: TopologySource): Promise<void> {
  const json = JSON.parse(await (await source.export({ format: 'geojson' })).text());
  expect(json.features[0].geometry.coordinates).toEqual(coordinates);
  expect(source.getCRS()).toBe('EPSG:4326');
}

describe('TopoJSON coordinate precision', () => {
  it('allows lossy automatic quantization only when explicitly requested', async () => {
    const source = await load('input.geojson', input);
    const blob = await source.export({ format: 'topojson', quantization: true });
    const topology = JSON.parse(await blob.text());
    expect(topology.transform.scale.every((step: number) => step > 0)).toBe(true);
    const quantized = await load('quantized.topojson', new Uint8Array(await blob.arrayBuffer()));
    const json = JSON.parse(await (await quantized.export({ format: 'geojson' })).text());
    expect(json.features[0].geometry.coordinates).not.toEqual(coordinates);
    await expectOriginalCoordinates(source);
  });
  it('preserves coordinates across repeated storage roundtrips without mutating the source', async () => {
    const original = await load('input.geojson', input);
    let stored = original;
    for (let i = 0; i < 4; i++) {
      stored = await roundtrip(stored);
      await expectOriginalCoordinates(stored);
      await expectOriginalCoordinates(original);
    }
  });

  it.each([
    'geojson',
    'shapefile',
    'topojson',
  ] as const)('preserves coordinates through import, projectLayer %s export and reimport', async (format) => {
    const source = await roundtrip(await load('input.geojson', input));
    const context = {
      host: {
        _removed: false,
        _sources: new Map([['s', source]]),
        fire: () => {
          throw new Error('unexpected engine error');
        },
      },
    } as unknown as OpContext;
    const result = await projectLayer(context, {
      source: 's',
      target: source.getLayers()[0].name!,
      init: 'EPSG:4326',
      crs: 'EPSG:4326',
      output: { format },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('projectLayer failed');
    const exported = await load(
      format === 'shapefile' ? 'out.zip' : `out.${format}`,
      new Uint8Array(await result.value.blob.arrayBuffer()),
    );
    await expectOriginalCoordinates(exported);
    await expectOriginalCoordinates(await roundtrip(exported));
    await expectOriginalCoordinates(source);
  });
});
