// Covers the FlatGeobuf example plugin end-to-end through the real source
// pipeline: '.fgb' must route to the registered DatasetFormatPlugin (not
// mapshaper's `-i`), produce a dataset, and carry the FGB header CRS as
// emap's canonical crs_string.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TopologySource } from '../../src/source/topology-source';
import { unregisterFormat } from '../../src/source/format-registry';
import { getDefaultMapshaperAdapter, registerFormat } from '../../src/index';
import { installFlatGeobufFormat } from '../../packages/examples/src/flatgeobuf-format';

const FIXTURE = resolve(
  process.cwd(),
  'packages/examples/public/fixtures/example-flatgeobuf.fgb',
);

describe('flatgeobuf example format plugin', () => {
  afterEach(() => {
    unregisterFormat('flatgeobuf');
  });

  it('imports .fgb through TopologySource.setData with header CRS', async () => {
    installFlatGeobufFormat({ registerFormat, getDefaultMapshaperAdapter });

    const source = new TopologySource('fgb');
    await source.setData({
      filename: 'example-flatgeobuf.fgb',
      content: new Uint8Array(readFileSync(FIXTURE)),
    });

    const dataset = source.getDataset();
    expect(dataset?.layers.length).toBeGreaterThan(0);
    const featureCount = dataset?.layers.reduce(
      (n, l) => n + (l.shapes?.length ?? 0),
      0,
    );
    expect(featureCount).toBe(3);
    expect(source.getCRS()).toBe('EPSG:4326');
  });

  it('rejects .fgb with a plugin-hinting error when nothing is registered', async () => {
    const source = new TopologySource('fgb-missing');
    await expect(
      source.setData({
        filename: 'example-flatgeobuf.fgb',
        content: new Uint8Array(readFileSync(FIXTURE)),
      }),
    ).rejects.toThrow(/format plugin/);
  });
});
