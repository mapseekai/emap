// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const DIST = resolve(__dirname, '../../dist');
const STRICT = ['emap.mjs', 'emap.js', 'emap-worker.js'];
const VENDOR = ['mapshaper-vendor.js', 'mapshaper-vendor.mjs'];
const ALL = [...STRICT, ...VENDOR];
const REQUIRE_RE = /require\$?1?\(\s*['"][^'"]+['"]\s*\)/g;

const distPresent = ALL.every((f) => existsSync(resolve(DIST, f)));
const d = distPresent ? describe : describe.skip;

async function loadEmap() {
  return import(/* @vite-ignore */ pathToFileURL(resolve(DIST, 'emap.mjs')).href);
}

// setData is synchronous; success/failure surface via 'data'/'error' events
// (see src/source/topology-source.ts — mirrors the fromBytes static).
function waitForLoad(src: any, input: any): Promise<void> {
  return new Promise((res, rej) => {
    const ok = () => { cleanup(); res(); };
    const bad = (e: any) => { cleanup(); rej(e?.error ?? e); };
    const cleanup = () => { src.off('data', ok); src.off('error', bad); };
    src.on('data', ok); src.on('error', bad);
    src.setData(input);
  });
}

d('shipped bundles are self-contained', () => {
  it.each(STRICT)('%s has zero require(...) calls', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    expect(m, `unexpected requires in dist/${f}: ${m.join(', ')}`).toEqual([]);
  });

  it.each(VENDOR)('%s has only the documented-dead require("adm-zip")', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    const others = [...new Set(m)].filter((r) => r !== 'require("adm-zip")');
    expect(others, `unexpected non-adm-zip requires in dist/${f}: ${others.join(', ')}`).toEqual([]);
  });

  it('survives esbuild browser pre-bundling with a require shim present', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'emap-esbuild-'));
    const entry = resolve(dir, 'entry.mjs');
    const bundle = resolve(dir, 'bundle.mjs');
    writeFileSync(
      entry,
      `import { TopologySource } from ${JSON.stringify(resolve(DIST, 'emap.mjs'))};\n` +
        'globalThis.__emapTopologySource = TopologySource;\n',
    );

    execFileSync(
      resolve(__dirname, '../../node_modules/.bin/esbuild'),
      [entry, '--bundle', '--format=esm', '--platform=browser', `--outfile=${bundle}`, '--log-level=warning'],
      { stdio: 'pipe' },
    );
    const bundled = readFileSync(bundle, 'utf8');
    expect(bundled).toContain('__require');

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `globalThis.window = globalThis.window || {};\n` +
          `globalThis.window.document = globalThis.window.document || {};\n` +
          `await import(${JSON.stringify(pathToFileURL(bundle).href)});\n`,
      ],
      { stdio: 'pipe' },
    );
  });

  it('loads valid GeoJSON with no dynamic-require failure', async () => {
    const { TopologySource } = await loadEmap();
    const geojson =
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{"id":1},' +
      '"geometry":{"type":"Polygon","coordinates":[[[0,0],[0,1],[1,1],[1,0],[0,0]]]}}]}';
    // Realm note: under the jsdom environment `new TextEncoder().encode()`
    // returns a jsdom-realm Uint8Array, which fails the bundle's
    // `content instanceof Uint8Array` check (Node-realm constructor) inside
    // mapshaper's importJSON — the byte→string branch is skipped and it
    // reports "Unknown JSON format". Constructing the bytes from a Node-realm
    // Buffer yields a Uint8Array the bundle genuinely decodes and parses, so
    // this exercises the real load path (fires 'data'), not a tolerated error.
    const content = Uint8Array.from(Buffer.from(geojson, 'utf8'));
    const src = new TopologySource('t');
    await expect(
      waitForLoad(src, { filename: 't.geojson', content }),
    ).resolves.toBeUndefined();
  });

  it('a .dbf shapefile ZIP does not cause a dynamic-require crash', async () => {
    const { TopologySource } = await loadEmap();
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
      expect(String(err)).not.toMatch(/Dynamic require of|Could not dynamically require/);
    }
  });
});
