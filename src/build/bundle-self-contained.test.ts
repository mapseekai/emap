// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

// Vitest injects a real CJS-style `__dirname` into the module scope (verified
// to resolve correctly under the jsdom environment, where `import.meta.url`
// is not a usable file URL at module-evaluation time).
const DIST = resolve(__dirname, '../../dist');
const BUNDLES = ['emap.mjs', 'emap.js', 'mapshaper-vendor.js', 'emap-worker.js'];

// Matches an unresolved CommonJS-style `require('...')` / `require$1('...')`
// call. esbuild/rollup rename collided requires to `require$1` etc., so the
// optional `$?1?` covers that. A self-contained browser bundle must have zero.
const REQUIRE_RE = /require\$?1?\(\s*['"][^'"]+['"]\s*\)/g;

const allFourBundlesExist = BUNDLES.every((f) => existsSync(resolve(DIST, f)));
const describeIfBuilt = allFourBundlesExist ? describe : describe.skip;

/**
 * `TopologySource.setData` is synchronous (returns `this`) and surfaces its
 * outcome through `'data'` / `'error'` events — exactly the contract the
 * built-in `fromBytes` static wraps. We model the wait the same way so the
 * behavioural assertions exercise the real load path.
 */
function waitForLoad(
  src: { on: Function; off: Function; setData: Function },
  payload: { filename: string; content: Uint8Array },
): Promise<void> {
  return new Promise<void>((resolveP, rejectP) => {
    let onData: () => void;
    let onError: (event: { error?: unknown }) => void;
    const cleanup = () => {
      src.off('data', onData);
      src.off('error', onError);
    };
    onData = () => {
      cleanup();
      resolveP();
    };
    onError = (event) => {
      cleanup();
      rejectP(event?.error ?? event);
    };
    src.on('data', onData);
    src.on('error', onError);
    src.setData(payload);
  });
}

describeIfBuilt('shipped bundles are self-contained (no Node dynamic requires)', () => {
  it.each(BUNDLES)('%s contains zero unresolved require(...) calls', (file) => {
    const code = readFileSync(resolve(DIST, file), 'utf8');
    const matches = code.match(REQUIRE_RE) ?? [];
    expect(
      matches,
      `unexpected Node requires in dist/${file}: ${matches.join(', ')}`,
    ).toEqual([]);
  });

  it('TopologySource.setData parses GeoJSON without a Dynamic require error', async () => {
    const { TopologySource } = await import(
      /* @vite-ignore */ pathToFileURL(resolve(DIST, 'emap.mjs')).href
    );
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'a' },
          geometry: { type: 'Point', coordinates: [0, 0] },
        },
      ],
    });
    const src = new TopologySource('t');
    await expect(
      waitForLoad(src, {
        filename: 'x.geojson',
        content: new TextEncoder().encode(geojson),
      }),
    ).resolves.not.toThrow();
  });

  it('TopologySource.setData parses a .dbf-bearing shapefile ZIP without a Dynamic require error', async () => {
    const { TopologySource } = await import(
      /* @vite-ignore */ pathToFileURL(resolve(DIST, 'emap.mjs')).href
    );
    const { zipSync, strToU8 } = await import('fflate');
    const zip = zipSync({
      'm.shp': new Uint8Array([0, 0, 39, 10]),
      'm.shx': new Uint8Array([0, 0, 39, 10]),
      'm.dbf': strToU8('dummy'),
    });
    const src = new TopologySource('t2');
    try {
      await waitForLoad(src, { filename: 'm.zip', content: zip });
    } catch (err) {
      // A mapshaper parse error on dummy bytes is acceptable; a Node
      // `Dynamic require of "..."` crash means the bundle is not
      // self-contained — that must never happen.
      expect(String(err)).not.toMatch(/Dynamic require of/);
    }
  });
});
