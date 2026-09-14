// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { beforeAll, describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../..');
const DIST = resolve(REPO, 'dist');
const STRICT = ['emap.mjs', 'emap.js', 'emap-worker.js'];
const VENDOR = ['mapshaper-vendor.js', 'mapshaper-vendor.mjs'];
const REQUIRE_RE = /(?<![\w.$])require\$?1?\(\s*['"][^'"]+['"]\s*\)/g;
const bin = (name: string) =>
  resolve(REPO, 'node_modules/.bin', process.platform === 'win32' ? `${name}.cmd` : name);
const runBin = (name: string, args: string[]) => {
  if (process.platform === 'win32') {
    return execFileSync('cmd', ['/c', bin(name), ...args], { stdio: 'pipe' });
  }
  return execFileSync(bin(name), args, { stdio: 'pipe' });
};

// This suite validates the *published* bundles, which only exist as the
// production build output. A prior `npm run dev-build` leaves unminified
// artifacts in dist/ that legitimately contain require(...) and would
// false-fail these assertions — the source of an implicit, order-dependent
// dist/ coupling.
//
// Fix: make the suite self-validating. `distIsSelfContained()` applies the
// exact same require(...) rules the `it`s assert. The build is triggered
// ONLY when the current dist/ already violates the invariant (dev build,
// dirty, or missing) — so a clean prod dist (CI / right after
// `npm run build`) costs nothing, while a dev/dirty dist self-heals
// deterministically. No build-mode sniffing; the gate IS the invariant.
function fileRequires(file: string): string[] {
  const p = resolve(DIST, file);
  if (!existsSync(p)) return ['<missing>'];
  return [...new Set(readFileSync(p, 'utf8').match(REQUIRE_RE) ?? [])];
}

function distIsSelfContained(): boolean {
  const strictClean = STRICT.every((f) => fileRequires(f).length === 0);
  const vendorClean = VENDOR.every(
    (f) => fileRequires(f).filter((r) => r !== 'require("adm-zip")').length === 0,
  );
  return strictClean && vendorClean;
}

const d = describe;

async function loadEmap() {
  return import(/* @vite-ignore */ pathToFileURL(resolve(DIST, 'emap.mjs')).href);
}

// setData is synchronous; success/failure surface via 'data'/'error' events
// (see src/domain/source/topology-source.ts — mirrors the fromBytes static).
function waitForLoad(src: any, input: any): Promise<void> {
  return new Promise((res, rej) => {
    const ok = () => {
      cleanup();
      res();
    };
    const bad = (e: any) => {
      cleanup();
      rej(e?.error ?? e);
    };
    const cleanup = () => {
      src.off('data', ok);
      src.off('error', bad);
    };
    src.on('data', ok);
    src.on('error', bad);
    src.setData(input);
  });
}

d('shipped bundles are self-contained', () => {
  beforeAll(() => {
    if (distIsSelfContained()) return; // clean prod dist — no rebuild needed
    // Production rollup bundles only — skip the `tsc -p tsconfig.build.json`
    // .d.ts emit from `npm run build`; declarations are irrelevant to a
    // require(...) scan.
    runBin('rollup', ['-c', '--environment', 'BUILD:production']);
  }, 180_000);

  it.each(STRICT)('%s has zero require(...) calls', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    expect(m, `unexpected requires in dist/${f}: ${m.join(', ')}`).toEqual([]);
  });

  it.each(VENDOR)('%s has only the documented-dead require("adm-zip")', (f) => {
    const m = readFileSync(resolve(DIST, f), 'utf8').match(REQUIRE_RE) ?? [];
    const others = [...new Set(m)].filter((r) => r !== 'require("adm-zip")');
    expect(others, `unexpected non-adm-zip requires in dist/${f}: ${others.join(', ')}`).toEqual(
      [],
    );
  });

  it('bootstraps the browser bundles without global Buffer or process', () => {
    const dom = new JSDOM('', { runScripts: 'outside-only', url: 'http://localhost/' });
    const browserWindow = dom.window as unknown as Window & {
      Buffer?: unknown;
      process?: unknown;
      mapshaper?: unknown;
      emap?: { Emap?: unknown };
    };
    browserWindow.URL.createObjectURL = () => 'blob:http://localhost/emap-test';
    browserWindow.URL.revokeObjectURL = () => {};

    try {
      expect(browserWindow.Buffer).toBeUndefined();
      expect(browserWindow.process).toBeUndefined();

      browserWindow.eval(readFileSync(resolve(DIST, 'mapshaper-vendor.js'), 'utf8'));
      browserWindow.eval(readFileSync(resolve(DIST, 'emap.js'), 'utf8'));

      expect(browserWindow.mapshaper).toEqual(expect.any(Object));
      expect(browserWindow.emap?.Emap).toEqual(expect.any(Function));
      expect(browserWindow.Buffer).toBeUndefined();
      expect(browserWindow.process).toBeUndefined();
    } finally {
      dom.window.close();
    }
  });

  it('uses one upstream Cordis instance across published ESM entry points', () => {
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { Context, Fiber } from 'cordis';
      import * as api from '@mapseekai/emap';
      import { Context as ExportedContext, inspectContext } from '@mapseekai/emap/context';
      import { arrowFormatsPlugin } from '@mapseekai/emap/arrow';
      assert.equal(ExportedContext, Context);
      for (const name of ['PluginRuntime', 'EffectScope', 'ServiceRegistry', 'serviceKey']) assert.ok(!(name in api));
      const map = await api.Emap.create({ preset: 'headless' });
      try {
        assert.ok(map.ctx instanceof Context && Context.is(map.ctx));
        for (const name of ['runtime', 'services', 'getService', 'use']) assert.ok(!(name in map));
        const fiber = map.ctx.plugin(arrowFormatsPlugin);
        assert.ok(fiber instanceof Fiber);
        await fiber.await();
        assert.equal(map.formats.list().length, 1);
        await fiber.dispose();
        assert.equal(map.formats.list().length, 0);
      } finally { await map.dispose(); }
      assert.equal(inspectContext(map.ctx).length, 0);
      console.log('native Cordis identity and cross-entry lifecycle verified');
    `,
      ],
      { cwd: REPO, encoding: 'utf8', timeout: 30_000 },
    );
    expect(result).toContain('native Cordis identity and cross-entry lifecycle verified');
  }, 35_000);

  it('does not embed full EPSG metadata in the browser ESM bundle', () => {
    const code = readFileSync(resolve(DIST, 'emap.mjs'), 'utf8');
    expect(Buffer.byteLength(code, 'utf8')).toBeLessThan(5_000_000);
    expect(code).not.toContain('China Geodetic Coordinate System 2000');
    expect(code).not.toContain('China - onshore and offshore.');
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

    runBin('esbuild', [
      entry,
      '--bundle',
      '--format=esm',
      '--platform=browser',
      `--outfile=${bundle}`,
      '--log-level=warning',
    ]);
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
    await expect(waitForLoad(src, { filename: 't.geojson', content })).resolves.toBeUndefined();
  }, 30_000);

  it('loads KML through the shipped browser ESM bundle', async () => {
    const { TopologySource } = await loadEmap();
    const kml =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
      '<Placemark><name>box</name><Polygon><outerBoundaryIs><LinearRing>' +
      '<coordinates>0,0 1,0 1,1 0,1 0,0</coordinates>' +
      '</LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>';
    const content = Uint8Array.from(Buffer.from(kml, 'utf8'));
    const src = new TopologySource('t-kml');
    await expect(waitForLoad(src, { filename: 't.kml', content })).resolves.toBeUndefined();
    expect(src.getLayers().map((l: { geometry_type: string | null }) => l.geometry_type)).toEqual([
      'polygon',
    ]);
  }, 30_000);

  it('reprojects GeoJSON through the shipped browser ESM bundle', async () => {
    const { TopologySource } = await loadEmap();
    const geojson =
      '{"type":"FeatureCollection","features":[{"type":"Feature","properties":{},' +
      '"geometry":{"type":"Point","coordinates":[116.4,39.9]}}]}';
    const content = Uint8Array.from(Buffer.from(geojson, 'utf8'));
    const src = new TopologySource('projection');
    await waitForLoad(src, { filename: 'projection.geojson', content });

    await expect(src.reproject('EPSG:3857')).resolves.toBeUndefined();
    expect(src.getCRS()).toBe('EPSG:3857');
  }, 30_000);

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
