import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { makeRasterFixture } from '../utils/raster-fixture.ts';

const workerCode = readFileSync(new URL('../../dist/emap-geotiff-worker.js', import.meta.url), 'utf8');
for (const unavailable of [false, true]) {
  test(`classic TIFF Worker decodes LZW with WASM ${unavailable ? 'unavailable' : 'enabled'}`, async ({ page }) => {
    const prefix = unavailable ? 'globalThis.WebAssembly = undefined;\n' : `
      const instantiate = WebAssembly.instantiate.bind(WebAssembly);
      WebAssembly.instantiate = (...args) => {
        self.postMessage({ type: 'wasm-initialize' });
        return instantiate(...args);
      };
    `;
    await page.route('**/lzw-test-worker.js', (route) => route.fulfill({
      contentType: 'application/javascript', body: prefix + workerCode,
    }));
    await page.goto('/mapseekai/emap/examples/');
    const bytes = Array.from(makeRasterFixture({
      width: 32, height: 16, bits: 16, bands: 3, compression: 'lzw',
      pixelValue: (x, y, band) => x + y * 32 + band * 1000,
    }));
    const result = await page.evaluate(async (bytes) => {
      const worker = new Worker('/lzw-test-worker.js');
      let wasmInitializations = 0;
      worker.addEventListener('message', ({ data }) => {
        if (data.type === 'wasm-initialize') wasmInitializations++;
      });
      const call = (message) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { cleanup(); reject(new Error('Worker response timeout')); }, 10000);
        const receive = ({ data }) => {
          if (data.id !== message.id) return;
          cleanup();
          data.type === 'error' ? reject(new Error(data.message)) : resolve(data);
        };
        const fail = (error) => { cleanup(); reject(new Error(error.message)); };
        const cleanup = () => {
          clearTimeout(timeout);
          worker.removeEventListener('message', receive);
          worker.removeEventListener('error', fail);
        };
        worker.addEventListener('message', receive);
        worker.addEventListener('error', fail);
        worker.postMessage(message);
      });
      try {
        const file = new File([new Uint8Array(bytes)], 'lzw.tif');
        // Send immediately: lazy WASM initialization must not lose the first message.
        await call({ id: 1, type: 'open', file, cacheBytes: 0 });
        const request = { level: 0, window: [0, 0, 32, 16], samples: [0, 1, 2] };
        const first = await call({ id: 2, type: 'read', request });
        const second = await call({ id: 3, type: 'read', request });
        return {
          wasmInitializations,
          first: first.result.data.map((band) => Array.from(band)),
          second: second.result.data.map((band) => Array.from(band)),
        };
      } finally { worker.terminate(); }
    }, bytes);
    const expected = [0, 1, 2].map((band) => Array.from({ length: 512 }, (_, i) => i + band * 1000));
    expect(result.first).toEqual(expected);
    expect(result.second).toEqual(expected);
    expect(result.wasmInitializations).toBe(unavailable ? 0 : 1);
  });
}
