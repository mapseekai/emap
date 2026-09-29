import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
const file = process.env.EMAP_RECOVERY_TIFF;
for (const backend of ['webgl', 'webgpu']) test(`${backend}: numeric raster recovers twice with identical pixels`, async ({page}, info) => {
  test.skip(!file, 'Set EMAP_RECOVERY_TIFF to an authorized UInt8/UInt16 TIFF.');
  test.skip(backend === 'webgpu' && info.project.name !== 'chrome', 'WebGPU unavailable in these browser projects.');
  test.setTimeout(180000);
  const before = await stat(file), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/mapseekai/emap/examples/luma-raster/?gpu=' + backend);
  await page.waitForFunction(() => window.lumaRaster?.state === 'idle');
  await page.locator('#file-input').setInputFiles(file);
  await page.locator('#load').click();
  await page.waitForFunction(() => ['ready', 'error'].includes(window.lumaRaster.state));
  await page.evaluate(() => window.lumaRaster.settle());
  await page.evaluate(async () => {
    const app = window.lumaRaster;
    app.setStyle({opacity: .5, resampling: 'bilinear', stretch: 'minmax'});
    app.setView(16); await app.settle();
    window.recoveryCheck = {source: app.source, reference: await app.capture(), old: null};
  });
  const rounds = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(backend => {
      const gpu = window.lumaRaster.native.gpu;
      window.recoveryCheck.old = gpu;
      if (backend === 'webgpu') gpu.device.handle.destroy();
      else { window.recoveryCheck.extension = gpu.device.gl.getExtension('WEBGL_lose_context'); window.recoveryCheck.extension.loseContext(); }
    }, backend);
    if (backend === 'webgl') {
      await page.waitForFunction(() => !window.lumaRaster.native.gpu.available);
      await page.waitForTimeout(100);
      await page.evaluate(() => window.recoveryCheck.extension.restoreContext());
    }
    await page.waitForFunction(() => window.lumaRaster.native.gpu !== window.recoveryCheck.old);
    await page.evaluate(() => window.lumaRaster.settle());
    const result = await page.evaluate(async () => {
      const app = window.lumaRaster, check = window.recoveryCheck, current = await app.capture();
      let changed = 0, painted = 0;
      for (let i = 0; i < current.pixels.length; i++) { if (current.pixels[i] !== check.reference.pixels[i]) changed++; if (i % 4 === 3 && current.pixels[i]) painted++; }
      return {changed, painted, sameSource: app.source === check.source, oldBytes: check.old.stats.liveTextureBytes, stats: app.stats()};
    });
    expect(result.changed).toBe(0); expect(result.painted).toBeGreaterThan(1000);
    expect(result.sameSource).toBe(true); expect(result.oldBytes).toBe(0);
    rounds.push(result);
  }
  await page.evaluate(() => window.lumaRaster.dispose());
  await expect.poll(() => page.workers().length).toBe(0);
  const released = await page.evaluate(() => window.lumaRaster.stats());
  expect(released.gpu.liveTextureBytes).toBe(0);
  expect(released.memory.sourceBlockCacheBytes).toBe(0);
  expect(errors).toEqual([]);
  const after = await stat(file); expect(after.size).toBe(before.size); expect(after.mtimeMs).toBe(before.mtimeMs);
  await info.attach('numeric-recovery', {body: JSON.stringify({rounds, released, errors}, null, 2), contentType: 'application/json'});
});
