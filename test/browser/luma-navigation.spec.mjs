import { test, expect } from '@playwright/test';
import { join } from 'node:path';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
async function digest(path) {
  const h = createHash('sha256');
  for await (const b of createReadStream(path)) h.update(b);
  return h.digest('hex');
}
const directory = process.env.EMAP_BENCHMARK_DATA_DIR;
const files = (
  process.env.EMAP_NAV_FILES ??
  'big.geojson,lucc.geojson,building.geojson,points.geojson,pppp.geojson'
).split(',');
const apis = (process.env.EMAP_NAV_APIS ?? 'webgl,webgpu').split(',');
const route = '/mapseekai/emap/examples/luma-benchmark/?parameters=open';
async function snapshotReady(page) {
  await page.waitForFunction(
    () => {
      const s = window.lumaBenchmark.navigationStats;
      return s.ready && !s.pending;
    },
    null,
    { timeout: 30000 },
  );
}
for (const api of apis)
  for (const file of files)
    test(`${api} ${file}: original geometry, range culling and snapshot navigation`, async ({
      page,
    }, info) => {
      test.skip(!directory, 'Authorized real files are required; no generated substitute.');
      test.setTimeout(300000);
      const hash = await digest(join(directory, file));
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      await page.goto(route + '&gpu=' + api + '&pointLod=off&screenFilter=off');
      await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle', null, {
        timeout: 60000,
      });
      await page.locator('#file-input').setInputFiles(join(directory, file));
      const start = Date.now();
      await page.locator('#load-file').click();
      await page.waitForFunction(
        () => ['ready', 'error'].includes(window.lumaBenchmark.state),
        null,
        { timeout: 180000 },
      );
      expect(
        await page.evaluate(() => window.lumaBenchmark.state),
        await page.locator('#status').textContent(),
      ).toBe('ready');
      await snapshotReady(page);
      const result = {
        api,
        file,
        sha256: hash,
        readyMs: Date.now() - start,
        views: [],
        environment: await page.evaluate(() => ({
          userAgent: navigator.userAgent,
          dpr: devicePixelRatio,
          canvas: [document.querySelector('#webgl').width, document.querySelector('#webgl').height],
        })),
      };
      result.source = await page.evaluate(() => {
        const e = window.lumaBenchmark;
        return {
          features: e.scene.featureCount,
          vertices: e.scene.vertexCount,
          geometryMode: e.lodStats.geometryMode,
        };
      });
      for (const [name, scale] of file === 'big.geojson'
        ? [
            ['fit', 1],
            ['far', Math.exp(-3.2)],
            ['near', 16],
          ]
        : [
            ['fit', 1],
            ['near', 16],
          ]) {
        await page.evaluate(() => window.lumaBenchmark.setFastNav(false));
        await page.evaluate((s) => window.lumaBenchmark.setView(s), scale);
        await page.waitForTimeout(250);
        const captures = [];
        for (const cull of [false, true]) {
          await page.evaluate((c) => window.lumaBenchmark.setPathCulling(c), cull);
          captures.push(await page.evaluate(() => window.lumaBenchmark.capturePixels()));
        }
        expect(captures[1].pixelHash, JSON.stringify({ file, api, name, captures })).toBe(
          captures[0].pixelHash,
        );
        expect(captures[1].paintedPixels).toBeGreaterThan(0);
        const geometry = await page.evaluate(() => window.lumaBenchmark.lodStats);
        expect(geometry.omitted).toBe(0);
        expect(geometry.missingChunks).toBe(0);
        // Force fresh full redraws; neither the CSS bitmap nor pixel readback is inside this timed loop.
        const full = await page.evaluate(async () => {
          const e = window.lumaBenchmark,
            gaps = [],
            cpu = [];
          for (let i = 0; i < 3; i++) {
            e.draw('luma');
            await new Promise(requestAnimationFrame);
          }
          let prev = await new Promise(requestAnimationFrame);
          for (let i = 0; i < 12; i++) {
            const t = performance.now();
            e.draw('luma');
            cpu.push(performance.now() - t);
            const now = await new Promise(requestAnimationFrame);
            gaps.push(now - prev);
            prev = now;
          }
          return { gaps, cpu, fps: 1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length) };
        });
        await page.evaluate(() => window.lumaBenchmark.setFastNav(true));
        await snapshotReady(page);
        const before = await page.evaluate(() => ({
          gpu: window.lumaBenchmark.gpuStats,
          nav: window.lumaBenchmark.navigationStats,
        }));
        await page.evaluate(() => {
          const s = (window.__navSample = {
            gaps: [],
            longTasks: [],
            inputGaps: [],
            last: 0,
            running: true,
          });
          s.observer = new PerformanceObserver((l) =>
            s.longTasks.push(...l.getEntries().map((e) => e.duration)),
          );
          s.observer.observe({ type: 'longtask', buffered: false });
          const tick = (t) => {
            if (!s.running) return;
            if (s.last) s.gaps.push(t - s.last);
            s.last = t;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          s.move = (e) => s.inputGaps.push(performance.now() - e.timeStamp);
          document.querySelector('#stage').addEventListener('pointermove', s.move);
        });
        const box = await page.locator('#stage').boundingBox(),
          x = box.x + box.width * 0.45,
          y = box.y + box.height * 0.45;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 1; i <= 30; i++) {
          await page.mouse.move(x + i * 4, y + Math.sin(i * 0.2) * 10);
          await page.waitForTimeout(16);
        }
        const during = await page.evaluate(() => ({
          gpu: window.lumaBenchmark.gpuStats,
          nav: window.lumaBenchmark.navigationStats,
          css: document.querySelector('.luma-nav-preview').style.transform,
        }));
        expect(during.nav.active).toBe(true);
        expect(during.nav.previewFrames).toBeGreaterThan(before.nav.previewFrames);
        expect(during.gpu.drawCalls).toBe(before.gpu.drawCalls);
        expect(during.gpu.uploads).toBe(before.gpu.uploads);
        const interactive = await page.evaluate(() => {
          const s = window.__navSample;
          s.running = false;
          s.observer.disconnect();
          document.querySelector('#stage').removeEventListener('pointermove', s.move);
          return { gaps: s.gaps, longTasks: s.longTasks, inputGaps: s.inputGaps };
        });
        if (file === 'big.geojson' && name === 'fit')
          await page.screenshot({ path: info.outputPath(name + '-navigation.png') });
        const release = Date.now();
        await page.mouse.up();
        await snapshotReady(page);
        const after = await page.evaluate(() => ({
          gpu: window.lumaBenchmark.gpuStats,
          nav: window.lumaBenchmark.navigationStats,
          view: window.lumaBenchmark.view,
        }));
        expect(after.nav.active).toBe(false);
        expect(after.gpu.drawCalls).toBeGreaterThan(during.gpu.drawCalls);
        for (const k of ['mx', 'my', 'bx', 'by'])
          expect(after.nav.frame[k]).toBeCloseTo(after.view[k], 7);
        expect(after.nav.captureErrors).toBe(0);
        result.views.push({
          name,
          scale,
          geometry,
          pixels: captures[1],
          full,
          interactive,
          settleWallMs: Date.now() - release,
          fullRedrawsAfterRelease: after.nav.fullRedraws - during.nav.fullRedraws,
          lastRefreshMs: after.nav.lastRefreshMs,
          newDrawsDuringDrag: during.gpu.drawCalls - before.gpu.drawCalls,
          newUploadsDuringDrag: during.gpu.uploads - before.gpu.uploads,
        });
      }
      // Resize invalidates the bitmap, then rebases the replacement instead of replaying a wrong DPR/size.
      const capturesBeforeResize = await page.evaluate(
        () => window.lumaBenchmark.navigationStats.captures,
      );
      await page.setViewportSize({ width: 1360, height: 900 });
      await page.waitForFunction(
        (c) => {
          const e = window.lumaBenchmark,
            s = e.navigationStats;
          return (
            s.captures > c && s.ready && !s.pending && document.querySelector('#webgl').width > 1250
          );
        },
        capturesBeforeResize,
        { timeout: 30000 },
      );
      const resized = await page.evaluate(() => ({
        n: window.lumaBenchmark.navigationStats,
        w: document.querySelector('#webgl').width,
        h: document.querySelector('#webgl').height,
      }));
      expect(resized.n.snapshotBytes).toBe(resized.w * resized.h * 4);
      if (file === 'big.geojson') {
        const box = await page.locator('#stage').boundingBox(),
          x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        const before = await page.evaluate(() => ({
          nav: window.lumaBenchmark.navigationStats,
          gpu: window.lumaBenchmark.gpuStats,
        }));
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, 35);
          await page.waitForTimeout(20);
        }
        const active = await page.evaluate(() => ({
          nav: window.lumaBenchmark.navigationStats,
          gpu: window.lumaBenchmark.gpuStats,
        }));
        expect(active.nav.active).toBe(true);
        expect(active.gpu.drawCalls).toBe(before.gpu.drawCalls);
        // A new pan starts before the wheel's settle timer: no premature full redraw during it.
        await page.mouse.down();
        await page.mouse.move(x + 25, y + 10);
        await page.waitForTimeout(400);
        expect(await page.evaluate(() => window.lumaBenchmark.navigationStats.active)).toBe(true);
        expect(await page.evaluate(() => window.lumaBenchmark.gpuStats.drawCalls)).toBe(
          active.gpu.drawCalls,
        );
        await page.mouse.up();
        await snapshotReady(page);
        result.wheel = {
          previewFrames: active.nav.previewFrames - before.nav.previewFrames,
          newDraws: active.gpu.drawCalls - before.gpu.drawCalls,
        };
        await page.selectOption('#backend', 'canvas');
        await page.waitForTimeout(50);
        await snapshotReady(page);
        const canvasBefore = await page.evaluate(() => window.lumaBenchmark.navigationStats);
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let i = 0; i < 8; i++) {
          await page.mouse.move(x + i * 4, y);
          await page.waitForTimeout(16);
        }
        const canvasDuring = await page.evaluate(() => window.lumaBenchmark.navigationStats);
        expect(canvasDuring.active).toBe(true);
        expect(canvasDuring.fullRedraws).toBe(canvasBefore.fullRedraws);
        await page.mouse.up();
        await snapshotReady(page);
        result.canvasPreviewFrames = canvasDuring.previewFrames - canvasBefore.previewFrames;
      const canvasPixels = await page.evaluate(() => {
        const c = document.querySelector('#canvas2d'), p = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let n=0;for(let i=3;i<p.length;i+=4)if(p[i])n++;return n;
      });
      expect(canvasPixels).toBeGreaterThan(0);result.canvasPaintedPixels=canvasPixels;
      }
      await page.evaluate(() => window.lumaBenchmark.dispose());
      await expect.poll(() => page.workers().length).toBe(0);
      expect(await page.evaluate(() => window.lumaBenchmark.gpuStats.liveBufferBytes)).toBe(0);
      await expect(page.locator('.luma-nav-preview')).toHaveCount(0);
      expect(errors).toEqual([]);
      expect(await digest(join(directory, file))).toBe(hash);
      result.sourceUnchanged = true;
      result.errors = errors;
      console.log('NAV_REAL', JSON.stringify(result));
      await info.attach('navigation-real-result', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
    });
