import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { makeRasterFixture } from '../utils/raster-fixture.ts';

const workerCode = readFileSync(new URL('../../dist/emap-geotiff-worker.js', import.meta.url), 'utf8');
for (const unavailable of [false, true]) {
  test(`classic TIFF Worker decodes LZW with WASM ${unavailable ? 'unavailable' : 'enabled'}`, async ({ page }) => {
    const prefix = unavailable ? 'globalThis.WebAssembly = undefined;\n' : `
      self.lzwWasmInitializations = 0;
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = (...args) => {
        self.lzwWasmInitializations++;
        return instantiate(...args);
      };
    `;
    await page.route('**/lzw-test-worker.js', (route) => route.fulfill({
      contentType: 'application/javascript', body: prefix + workerCode,
    }));
    await page.route(/\/(?:emap[^/]*|mapshaper-vendor)\.mjs$/, route => route.fulfill({
      path: resolve('dist', basename(new URL(route.request().url()).pathname)),
      contentType: 'text/javascript',
    }));
    await page.goto('/mapseekai/emap/examples/luma-benchmark/');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    const bytes = Array.from(makeRasterFixture({
      width: 32, height: 16, bits: 16, bands: 3, compression: 'lzw',
      pixelValue: (x, y, band) => x + y * 32 + band * 1000,
    }));
    try {
      const result = await page.evaluate(async (bytes) => {
        const { openGeoTIFF } = await import('/mapseekai/emap/examples/emap-geotiff.mjs');
        const runtime = window.lzwRuntime = emap.createEmapWorkerRuntime({
          urls: { geotiff: new URL('/lzw-test-worker.js', location.href).href },
          sizes: { geotiff: 1 },
        });
        const file = new File([new Uint8Array(bytes)], 'lzw.tif');
        // Use the public client so startup and lazy WASM run through the real tasklane protocol.
        const source = window.lzwSource = await openGeoTIFF(file, {
          workerRuntime: runtime, workerCount: 1, blockCacheBytes: 8 * 1024 ** 2,
        });
        await runtime.setMemoryPressure('moderate');
        const request = { level: 0, window: [0, 0, 32, 16], samples: [0, 1, 2] };
        const first = await source.readWindow(request);
        const second = await source.readWindow(request);
        return {
          first: first.data.map((band) => Array.from(band)),
          second: second.data.map((band) => Array.from(band)),
          cacheLimits: [first, second].map(result => result.diagnostics.blockCacheLimitBytes),
          misses: [first, second].map(result => result.diagnostics.blockCacheMisses),
        };
      }, bytes);
      const expected = [0, 1, 2].map((band) => Array.from({ length: 512 }, (_, i) => i + band * 1000));
      expect(result.first).toEqual(expected);
      expect(result.second).toEqual(expected);
      expect(result.cacheLimits).toEqual([0, 0]);
      for (const misses of result.misses) expect(misses).toBeGreaterThan(0);
      const workers = page.workers().filter(worker => worker.url().endsWith('/lzw-test-worker.js'));
      expect(workers).toHaveLength(1);
      expect(await workers[0].evaluate(() => self.lzwWasmInitializations ?? 0)).toBe(unavailable ? 0 : 1);
    } finally {
      await page.evaluate(async () => {
        window.lzwSource?.dispose(); await window.lzwSource?.settled;
        await window.lzwRuntime?.dispose();
      });
    }
  });
}
