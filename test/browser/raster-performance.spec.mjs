import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Opt-in same-file benchmark. Source files stay on disk, never copied to fixtures.
test('measure raster source-cold and warm navigation throughput', async ({ page }) => {
  const file = process.env.EMAP_GEOTIFF_LOCAL_FILE;
  test.skip(!file, 'Set EMAP_GEOTIFF_LOCAL_FILE to benchmark a local TIFF/.ovr pair.');
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.rasterReadEvents = [];
    window.Worker = class extends NativeWorker {
      pending = new Map();
      constructor(...args) {
        super(...args);
        this.addEventListener('message', ({ data }) => {
          const event = this.pending.get(data.id);
          if (event) { event.end = performance.now(); event.ok = data.type !== 'error'; this.pending.delete(data.id); }
        });
      }
      postMessage(message, ...args) {
        if (message.type === 'read' || message.type === 'render') {
          const event = { start: performance.now(), end: 0, level: message.type === 'read' ? message.request.level : message.request.read.level };
          this.pending.set(message.id, event); window.rasterReadEvents.push(event);
        }
        super.postMessage(message, ...args);
      }
    };
  });
  await page.goto('/mapseekai/emap/examples/geotiff-viewer/');
  await expect(page.locator('#levels')).toHaveText('4');
  await page.locator('#file-input').setInputFiles(file);
  await page.locator('#overview-input').setInputFiles(file + '.ovr');
  await expect.poll(() => page.evaluate(() => {const s=window.geotiffDemo;const v=s.stats();return Number(s.loading)+v.activeReads+v.queuedReads+v.pendingFrames+Number(v.interacting);})).toBe(0);
  const results = [];
  for (let round = 0; round < 3; round++) {
    const metrics = await page.evaluate(async round => {
      const s = window.geotiffDemo, records = [];
      const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
      async function measure(name, action) {
        const before = s.stats(), start = performance.now(), index = window.rasterReadEvents.length;
        let first = null, lastCount = before.presentedTiles, updates = 0, stable = 0;
        await action();
        while (performance.now() - start < 30000) {
          await nextFrame(); const now = s.stats();
          if (now.presentedTiles > lastCount) {
            first ??= performance.now() - start; updates++; lastCount = now.presentedTiles;
          }
          const complete = !s.loading && !now.interacting && !now.activeReads && !now.queuedReads && !now.pendingFrames;
          if (complete && now.committedFrames > before.committedFrames) stable++; else stable = 0;
          if (stable === 3) {
            const reads = window.rasterReadEvents.slice(index).filter(e => e.end && e.ok);
            const delta=(key)=>{const value=now.performance[key]-before.performance[key];return value>=0?value:now.performance[key];};
            records.push({ round, name, totalMs: performance.now()-start, firstMs:first, updates, tiles:now.presentedTiles-before.presentedTiles, reads:reads.length, readTimeMs:reads.reduce((n,e)=>n+e.end-e.start,0), firstReadMs:reads.length?reads[0].start-start:0, cacheMiB:now.cachedBytes/1024**2,
              phases:{planningMs:delta('planningMs'),fileReadMs:delta('fileReadMs'),blockLoadMs:delta('blockLoadMs'),assembleMs:delta('assembleMs'),colorizeMs:delta('colorizeMs'),workerMs:delta('workerMs'),transferMs:delta('transferMs'),canvasUploadMs:delta('canvasUploadMs'),presentationWaitMs:delta('presentationWaitMs')},
              io:{bytes:delta('fileReadBytes'),ops:delta('fileReadOps'),pageHits:delta('pageCacheHits'),pageMisses:delta('pageCacheMisses'),blockHits:delta('blockCacheHits'),blockMisses:delta('blockCacheMisses')} });
            if (s.error) throw new Error(s.error); return;
          }
        }
        throw new Error('Benchmark did not settle: ' + name);
      }
      await measure('load-source-cold', () => s.load(document.getElementById('file-input').files[0], document.getElementById('overview-input').files[0]));
      const view = s.map.ctx.view, baseScale = Math.abs(view.getTransform().mx), center = view.getCenter();
      await measure('zoom-2x', () => view.jumpTo({ center, scale:baseScale*2 }));
      await measure('pan', () => s.map.panBy([150,-75], {duration:0}));
      await measure('zoom-4x', () => view.jumpTo({ scale:baseScale*4 }));
      await measure('style-minmax', () => s.map.ctx.raster.setStyle(s.currentId,{stretch:'minmax'}));
      await measure('return-full-warm', () => view.jumpTo({center,scale:baseScale}));
      await measure('zoom-2x-warm', () => view.jumpTo({center,scale:baseScale*2}));
      return records;
    }, round);
    results.push(...metrics);
  }
  console.log('RASTER_BENCHMARK', JSON.stringify(results));
  if (process.env.EMAP_RASTER_BENCH_OUT) await writeFile(process.env.EMAP_RASTER_BENCH_OUT, JSON.stringify(results,null,2));
  expect(results).toHaveLength(21);
  await page.evaluate(() => window.geotiffDemo.map.dispose());
});
