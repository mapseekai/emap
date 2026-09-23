import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { makeRasterFixture } from '../utils/raster-fixture.ts';

const url = '/mapseekai/emap/examples/geotiff-viewer/';
test.beforeEach(async ({ page }) => installCanvasReadback(page));
async function idle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect.poll(() => page.evaluate(() => {
    const state = window.geotiffDemo;
    const s = state.stats();
    return Number(state.loading) + s.activeReads + s.queuedReads + s.pendingFrames + Number(s.interacting);
  })).toBe(0);
  // Decoding completion precedes the RAF that paints the last accepted tile.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
async function ready(page) {
  await page.goto(url);
  await expect(page.locator('#levels')).toHaveText('4');
  await idle(page);
}
async function loadPair(page, original, overview) {
  await page.locator('#file-input').setInputFiles(original);
  await page.locator('#overview-input').setInputFiles(overview);
  await page.locator('#load').click();
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.metadata?.filename)).toBe(basename(original));
  await idle(page);
}

async function coverage(page) {
  return page.evaluate(async () => {
    const s = window.geotiffDemo, [left, bottom, right, top] = s.metadata.bounds;
    const canvas = document.querySelector('#map canvas');
    const pixels = await window.readCanvasPixels(canvas), rect = canvas.getBoundingClientRect();
    const missing = []; let valid = 0;
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) for (const v of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const x = left + (right-left)*u, y = top - (top-bottom)*v;
      const source = await s.map.ctx.raster.queryPixel(s.currentId, x, y);
      if (!source || source.some(n => !Number.isFinite(n) || n === s.metadata.noData)) continue;
      const [px, py] = s.map.ctx.view.project(x, y);
      const cx = Math.floor(px * canvas.width / rect.width), cy = Math.floor(py * canvas.height / rect.height);
      if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) continue;
      valid++;
      if (pixels[(cy * canvas.width + cx) * 4 + 3] === 0) missing.push([u, v]);
    }
    return { valid, missing, error: s.error, stats: s.stats(), levels: s.metadata.levels.map(l => [l.width, l.height]) };
  });
}

// Queue completion does not imply the host has presented its final Canvas frame.
// Poll pixels instead of assuming a fixed number of RAFs works in every browser.
async function presentedCoverage(page) {
  let result;
  await expect.poll(async () => {
    result = await coverage(page);
    return result.missing.length;
  }).toBe(0);
  return result;
}

test('classic Worker accepts a three-band MINISBLACK source with RGB external overviews', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'emap-external-overview-'));
  const original = join(directory, 'external.tif'), overview = original + '.ovr';
  const common = { bits: 16, bands: 3, compression: 'deflate', pixelValue: (_x, _y, b) => 40+b*60 };
  try {
    await writeFile(original, makeRasterFixture({ ...common, width: 512, height: 256, photometric: 1, extraSamples: [0, 0] }));
    await writeFile(overview, makeRasterFixture({ ...common, width: 256, height: 128, photometric: 2, subfileType: 1, scaleFactor: 2, overviews: [2, 4, 8, 16, 32] }));
    await ready(page);
    await loadPair(page, original, overview);
    await expect(page.locator('#levels')).toHaveText('7');
    await expect(page.locator('#metadata')).toContainText('external.tif.ovr');
    const result = await presentedCoverage(page);
    console.log('fixture-overview', JSON.stringify(result));
    expect(result.error).toBeNull();
    expect(result.valid).toBe(25);
    expect(result.missing).toEqual([]);
    expect(result.stats.cachedBytes).toBeLessThanOrEqual(32*1024**2);
    expect(await page.evaluate(() => {
      const s = window.geotiffDemo;
      return s.map.ctx.raster.queryPixel(s.currentId, 116.005, 39.995);
    })).toEqual([40, 100, 160]);
  } finally { await page.close(); await rm(directory, { recursive: true, force: true }); }
});

// Opt-in real-file regression; private imagery is never copied into fixtures or uploaded.
test('local external-pyramid imagery remains complete through navigation', async ({ page }, testInfo) => {
  const original = process.env.EMAP_GEOTIFF_LOCAL_FILE;
  test.skip(!original, 'Set EMAP_GEOTIFF_LOCAL_FILE to exercise a local TIFF/.ovr pair.');
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await loadPair(page, original, original + '.ovr');
  expect(await page.evaluate(() => window.geotiffDemo.metadata.levels.length)).toBeGreaterThan(1);
  for (const action of ['initial', 'zoom', 'pan', 'zoom', 'fit']) {
    const beforeReads = await page.evaluate(() => window.geotiffDemo.stats().readRequests);
    if (action === 'zoom') await page.evaluate(() => {
      const view = window.geotiffDemo.map.ctx.view;
      view.jumpTo({ scale: Math.abs(view.getTransform().mx) * 2 });
    });
    if (action === 'pan') await page.evaluate(() => window.geotiffDemo.map.panBy([100, -60], { duration: 0 }));
    if (action === 'fit') await page.evaluate(() => window.geotiffDemo.fit());
    await idle(page);
    const result = await presentedCoverage(page);
    console.log('local-overview', action, JSON.stringify(result));
    expect(result.stats.interacting).toBe(false);
    if (action === 'zoom') expect(result.stats.readRequests).toBeGreaterThan(beforeReads);
    expect(result.error).toBeNull();
    expect(result.valid).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
    expect(result.stats.cachedBytes).toBeLessThanOrEqual(32*1024**2);
  }
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('local-overview.png') });
  await page.evaluate(() => window.geotiffDemo.map.dispose());
});

test('classic Worker uses direct chunky RGB8 nearest rendering without deinterleave', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'emap-rgb8-direct-'));
  const original = join(directory, 'rgb8-direct.tif');
  try {
    await writeFile(original, makeRasterFixture({
      width: 512,
      height: 256,
      bits: 8,
      bands: 3,
      compression: 'deflate',
      pixelValue: (x, y, band) => (x + y * 3 + band * 47) & 255,
    }));
    await ready(page);
    await page.locator('#file-input').setInputFiles(original);
    await page.locator('#load').click();
    await expect.poll(() => page.evaluate(() => window.geotiffDemo.metadata?.filename)).toBe('rgb8-direct.tif');
    await idle(page);
    await page.locator('#performance-reset').click();
    await page.evaluate(() => {
      const state = window.geotiffDemo;
      state.map.ctx.raster.setStyle(state.currentId, { stretch: 'minmax' });
    });
    await expect.poll(() => page.evaluate(() => {
      const diagnostics = window.geotiffDemo.performanceDiagnostics;
      return Boolean(diagnostics?.stable && diagnostics.tiles > 0);
    })).toBe(true);
    const diagnostics = await page.evaluate(() => window.geotiffDemo.performanceDiagnostics);
    expect(diagnostics.rgb8Direct.tiles).toBeGreaterThan(0);
    expect(diagnostics.rgb8Direct.deinterleaveMs).toBe(0);
    expect(diagnostics.phasesMs.deinterleave).toBe(0);
    expect(diagnostics.fastLzw.fallbacks).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('directory authorization auto-resolves a same-folder .tif.ovr companion', async ({ page }) => {
  const original = Array.from(makeRasterFixture({ width: 64, height: 32, bits: 16, bands: 3, photometric: 1 }));
  const overview = Array.from(makeRasterFixture({ width: 32, height: 16, bits: 16, bands: 3, photometric: 2, subfileType: 1, scaleFactor: 2, overviews: [2, 4] }));
  await page.addInitScript(({ original, overview }) => {
    const files = new Map([
      ['auto.tif', new File([new Uint8Array(original)], 'auto.tif', { lastModified: 10 })],
      ['auto.tif.ovr', new File([new Uint8Array(overview)], 'auto.tif.ovr', { lastModified: 11 })],
      ['notes.txt', new File(['ignore'], 'notes.txt')],
    ]);
    window.showDirectoryPicker = async () => ({
      kind: 'directory',
      name: 'imagery',
      async *entries() {
        for (const [name, file] of files) yield [name, { kind: 'file', name, getFile: async () => file }];
      },
      async getFileHandle(name) {
        const file = files.get(name);
        if (!file) throw new DOMException('Not found', 'NotFoundError');
        return { kind: 'file', name, getFile: async () => file };
      },
    });
  }, { original, overview });
  await page.goto(url);
  await expect(page.locator('#levels')).toHaveText('4');
  await page.locator('#directory-picker').click();
  const raster = page.locator('#directory-raster-list input[type="checkbox"]');
  await expect(raster).toHaveCount(1);
  await expect(raster).toHaveValue('auto.tif');
  await expect(raster).toBeChecked();
  await expect(page.locator('#directory-status')).toContainText('已关联 auto.tif.ovr');
  await expect.poll(() => page.evaluate(() => window.geotiffDemo.metadata?.filename)).toBe('auto.tif');
  await expect(page.locator('#metadata')).toContainText('auto.tif.ovr');
  await expect(page.locator('#levels')).toHaveText('4');
  await idle(page);
  expect(await page.evaluate(() => window.geotiffDemo.error)).toBeNull();
});
