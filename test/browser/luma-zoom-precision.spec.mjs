import { test, expect } from '@playwright/test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
const directory = process.env.EMAP_BENCHMARK_DATA_DIR;
const bundle = resolve('test-results/zoom-precision/fixture.js');
test.beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const esbuild = await import(pathToFileURL(createRequire(require.resolve('vite')).resolve('esbuild')).href);
  await mkdir(resolve('test-results/zoom-precision'), { recursive: true });
  await esbuild.build({ entryPoints: [resolve('test/browser/fixtures/luma-zoom-precision.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: bundle, define: { 'process.env.NODE_ENV': '"production"' } });
});
for (const backend of ['webgl', 'webgpu']) {
  test(`${backend}: real LUCC deep-zoom positions match double-precision CPU projection`, async ({ page }, info) => {
    test.skip(!directory, 'Requires the authorized complete LUCC file.'); test.setTimeout(240000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/mapseekai/emap/examples/luma-benchmark/?gpu=' + backend + '&pointLod=off');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    await page.locator('#file-input').setInputFiles(join(directory, 'lucc.geojson')); await page.locator('#load-file').click();
    await page.waitForFunction(() => ['ready', 'error'].includes(window.lumaBenchmark.state), null, { timeout: 180000 });
    expect(await page.evaluate(() => window.lumaBenchmark.state)).toBe('ready');
    await page.addScriptTag({ path: bundle }); const result = await page.evaluate(b => window.verifyZoomPrecision(b), backend);
    await info.attach('deep-zoom-pixels', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.log('ZOOM_PRECISION', JSON.stringify(result));
    expect(result.errors).toEqual([]); expect(result.rows.length).toBe(180);
    for (const row of result.rows) {
      expect(row.painted, JSON.stringify(row)).toBeGreaterThan(0); expect(row.referencePainted, JSON.stringify(row)).toBeGreaterThan(0);
      expect(row.unmatched, JSON.stringify(row)).toBe(0);
      if ('centerErrorCss' in row) { expect(row.centerErrorCss).not.toBeNull(); expect(row.centerErrorCss, JSON.stringify(row)).toBeLessThan(0.25); }
    }
    expect(result.resources.liveBufferBytes).toBe(0); await page.evaluate(() => window.lumaBenchmark.dispose());
    await expect.poll(() => page.workers().length).toBe(0); expect(errors).toEqual([]);
  });
}

// The real editor must use the same projection as its CPU hit-testing and its
// filtered background, including when the backdrop bitmap is reused.
for (const backend of ['webgl', 'webgpu']) for (const dpr of [1.25, 2]) {
  test(`${backend} DPR ${dpr}: LUCC handles, filtered background and cached editing align at deep zoom`, async ({ browser }, info) => {
    test.skip(!directory, 'Requires the authorized complete LUCC file.'); test.setTimeout(240000);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: dpr });
    const page = await context.newPage(), errors = [], rows = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto('/mapseekai/emap/examples/luma-vertex-editing/?gpu=' + backend);
      await page.waitForFunction(() => window.lumaEditor?.state === 'idle');
      await page.locator('#file-input').setInputFiles(join(directory, 'lucc.geojson')); await page.locator('#load').click();
      await page.waitForFunction(() => ['ready', 'error'].includes(window.lumaEditor.state), null, { timeout: 180000 });
      expect(await page.evaluate(() => window.lumaEditor.state)).toBe('ready');
      await page.locator('#feature-id').fill('0'); await page.locator('#select-id').click(); await page.locator('#fit-selected').click();
      await page.selectOption('#mode', 'vertex'); await page.evaluate(() => window.lumaEditor.settle());
      const target = await page.evaluate(() => {
        const e = window.lumaEditor, r = document.querySelector('#stage').getBoundingClientRect();
        const h = e.session.vertexHandles.find(h => { const p = e.project(...h.position); return p[0] > 120 && p[0] < r.width - 120 && p[1] > 120 && p[1] < r.height - 120; });
        return { position: [...h.position], vertex: h.vertex };
      });
      const measure = async direct => page.evaluate(async ({ direct, vertex }) => {
        const e = window.lumaEditor, h = e.session.vertexHandles.find(h => h.vertex === vertex), expected = e.project(...h.position);
        const before = e.presentation.backdrop.overlayFrames;
        const c = await e.capturePixels(direct, true), p = c.pixels, r = document.querySelector('#stage').getBoundingClientRect();
        const px = c.width / Math.floor(r.width), py = c.height / Math.floor(r.height);
        let sx = 0, sy = 0, white = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          if (Math.abs(x / px - expected[0]) > 100 || Math.abs(y / py - expected[1]) > 100) continue;
          const i = (y * c.width + x) * 4;
          if (p[i] > 235 && p[i + 1] > 235 && p[i + 2] > 235 && p[i + 3] > 240) { sx += (x + 0.5) / px; sy += (y + 0.5) / py; white++; }
        }
        return { direct, expected, white, errorCss: white ? Math.hypot(sx / white - expected[0], sy / white - expected[1]) : null,
          cachedFrame: e.presentation.backdrop.overlayFrames > before, missing: e.lod.missingChunks, filter: e.screenFilterStats.applied };
      }, { direct, vertex: target.vertex });
      for (const filtered of [true, false]) {
        await page.locator('#small-arc-filter').setChecked(filtered); await page.locator('#half-pixel-filter').setChecked(filtered);
        for (const scale of [1e6, 1e7, 1e8]) {
          const captures = await page.evaluate(() => window.lumaEditor.presentation.backdrop.captures);
          await page.evaluate(async ({ target, scale }) => {
            const e = window.lumaEditor, s = e.session, original = s.selectionBounds, b = original.call(s), r = document.querySelector('#stage').getBoundingClientRect();
            // Invoke the actual fit/view path with a tiny extent around a real vertex;
            // no source coordinate is synthesized or altered to build this view.
            const cx = target.position[0] - 63.25 / scale, cy = target.position[1] - 47.75 / scale;
            b.xmin = cx - r.width / (2 * scale); b.xmax = cx + r.width / (2 * scale);
            b.ymin = cy - r.height / (2 * scale); b.ymax = cy + r.height / (2 * scale);
            try { s.selectionBounds = () => b; e.fitSelected(); } finally { s.selectionBounds = original; }
            await e.settle();
          }, { target, scale });
          await page.waitForFunction(n => window.lumaEditor.presentation.backdrop.captures > n, captures);
          for (const direct of [true, false]) {
            const row = { filtered, scale, ...await measure(direct) }; rows.push(row);
            expect(row.white, JSON.stringify(row)).toBeGreaterThan(0); expect(row.errorCss, JSON.stringify(row)).toBeLessThan(0.75);
            expect(row.missing).toBe(0); if (!direct) expect(row.cachedFrame).toBe(true);
            expect(row.filter).toBe(filtered);
          }
        }
      }
      // Use the CPU hit position, not the observed GPU centroid, for a real drag.
      const before = await page.evaluate(() => ({ version: window.lumaEditor.session.dataset.editVersion ?? 0, data: window.lumaEditor.session.exportSelected() }));
      const hit = await measure(true), box = await page.locator('#stage').boundingBox();
      await page.mouse.move(box.x + hit.expected[0], box.y + hit.expected[1]); await page.mouse.down();
      expect(await page.evaluate(() => !!window.lumaEditor.session.draft)).toBe(true);
      await page.mouse.move(box.x + hit.expected[0] + 13, box.y + hit.expected[1] + 7, { steps: 4 }); await page.mouse.up();
      await page.waitForFunction(v => { const e = window.lumaEditor; return e.state === 'ready' && e.displayRevision > v; }, before.version);
      const edited = await measure(true); expect(edited.errorCss).toBeLessThan(0.75);
      await page.locator('#undo').click(); await page.waitForFunction(() => window.lumaEditor.state === 'ready');
      expect(await page.evaluate(() => window.lumaEditor.session.exportSelected())).toBe(before.data);
      const undone = await measure(true); expect(undone.errorCss).toBeLessThan(0.75);
      await page.locator('#stage').screenshot({ path: info.outputPath('lucc-deep-zoom.png') });
      const result = { backend, dpr, rows, edited, undone, errors };
      await info.attach('editor-deep-zoom', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
      console.log('EDITOR_ZOOM_PRECISION', JSON.stringify(result));
      await page.evaluate(() => window.lumaEditor.dispose()); await expect.poll(() => page.workers().length).toBe(0);
      expect(await page.evaluate(() => window.lumaEditor.gpuStats.liveBufferBytes)).toBe(0); expect(errors).toEqual([]);
    } finally { await context.close(); }
  });
}
