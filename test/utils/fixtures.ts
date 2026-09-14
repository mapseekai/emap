// Test-only helpers for loading the on-disk fixtures under `test/fixtures/`
// and turning them into the in-memory shapes the engine consumes (raw GeoJSON
// strings, full mapshaper datasets, registered TopologySources).
//
// Imported by `*.test.ts`; never bundled into the production output.
//
// Conventions:
//   - Fixture files live under the repo's `test/fixtures/` directory.
//   - Path argument to `loadFixtureBytes` is the base name (e.g. `'tiny.geojson'`),
//     resolved against `test/fixtures/`. No `..` traversal.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TopologySource } from '../../src/domain/source/topology-source';
import type { MapshaperDataset } from '../../src/shared/types/mapshaper-types';
import { getDefaultMapshaperAdapter } from '../../src/integrations/mapshaper/adapter';

const FIXTURES_DIR = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', 'fixtures');

/** Read raw fixture bytes from `test/fixtures/<name>`. Synchronous; tests
 *  are sync-friendly. */
export function loadFixtureBytes(name: string): Uint8Array {
  if (name.includes('..') || name.startsWith('/')) {
    throw new Error(`loadFixtureBytes: invalid name ${name}`);
  }
  const path = resolve(FIXTURES_DIR, name);
  return new Uint8Array(readFileSync(path));
}

/** Read a fixture as a UTF-8 string (`.geojson`, `.csv`, `.prj`, ...). */
export function loadFixtureText(name: string): string {
  return new TextDecoder().decode(loadFixtureBytes(name));
}

/**
 * Import a fixture through the real mapshaper pipeline and resolve with
 * the resulting dataset. Equivalent to what `TopologySource.setData`
 * does internally, but synchronous-result via `await` so a test can do:
 *
 *   const ds = await loadFixtureDataset('tiny.geojson');
 *   expect(ds.layers[0].shapes).toHaveLength(3);
 */
export async function loadFixtureDataset(name: string): Promise<MapshaperDataset> {
  const bytes = loadFixtureBytes(name);
  const inputFiles: Record<string, Uint8Array | string> = { [name]: bytes };
  return getDefaultMapshaperAdapter().runImport(`-i "${name}"`, inputFiles);
}

/**
 * Build a `TopologySource` whose dataset is the fixture, and resolve once
 * its `data` event fires. Useful for end-to-end tests that exercise the
 * real source / adapter / event-loop boundary.
 *
 *   const source = await buildFixtureSource('topology-shared.geojson', 'mySrc');
 *   await map.addSource(source.id, source);
 */
export async function buildFixtureSource(
  fixtureName: string,
  sourceId = 'fixture',
): Promise<TopologySource> {
  const source = new TopologySource(sourceId);
  return new Promise<TopologySource>((resolveCb, reject) => {
    let onData: () => void;
    let onError: (e: { error?: unknown }) => void;
    const cleanup = () => {
      source.off('data', onData);
      source.off('error', onError);
    };
    onData = () => {
      cleanup();
      resolveCb(source);
    };
    onError = (e) => {
      cleanup();
      reject(e?.error ?? e);
    };
    source.on('data', onData);
    source.on('error', onError);
    source.setData({ filename: fixtureName, content: loadFixtureBytes(fixtureName) });
  });
}
