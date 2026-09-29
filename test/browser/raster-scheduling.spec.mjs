import { test, expect } from '@playwright/test';
import { basename, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';

test('adaptive reader admission grows, reclaims optional replicas and reopens them without changing samples', async ({ page }) => {
  await page.route(/\/(?:emap[^/]*|mapshaper-vendor)\.mjs$/, route => route.fulfill({
    path: resolve('dist', basename(new URL(route.request().url()).pathname)), contentType: 'text/javascript',
  }));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    const { openGeoTIFF } = await import('../emap-geotiff.mjs');
    const runtime = emap.createEmapWorkerRuntime({ urls: {
      geotiff: new URL('../emap-geotiff-worker.js', location.href).href,
    }, sizes: { geotiff: 2 }, adaptive: { geotiff: { minWorkers: 1, sampleMs: 20, idleMs: 100 } } });
    let source;
    const counts = [];
    const wait = async count => {
      const start = performance.now();
      while (runtime.stats.workers !== count || (count === 2 &&
        runtime.diagnostics().pools.find(p => p.name === 'geotiff').resources.length !== 2)) {
        if (performance.now() - start > 10_000) throw Error(`Did not reach ${count} readers`);
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      counts.push(runtime.stats.workers);
    };
    try {
      const blob = await (await fetch('../fixtures/example-geotiff.tif')).blob();
      source = await openGeoTIFF(new File([blob], 'fixture.tif'), {
        workerRuntime: runtime, workerCount: 2, workerScheduling: 'cache-aware',
      });
      const request = { level: 0, window: [0, 0, 32, 32], samples: [0] };
      const before = await source.readWindow(request);
      for (let i = 0; i < 3; i++) {
        await wait(2); await wait(1);
        const after = await source.readWindow(request);
        if (!after.data[0].every((v, index) => v === before.data[0][index])) throw Error('Samples changed');
      }
    } finally { source?.dispose(); await source?.settled; await runtime.dispose(); }
    return { counts, workers: runtime.stats.workers, resources: runtime.stats.resourceLeases, resident: runtime.stats.reserved.residentBytes };
  });
  expect(result).toEqual({ counts: [2, 1, 2, 1, 2, 1], workers: 0, resources: 0, resident: 0 });
});

test('trimmed reader caches recover on demand within runtime targets across borrowed sources', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/\/(?:emap[^/]*|mapshaper-vendor)\.mjs$/, route => route.fulfill({
    path: resolve('dist', basename(new URL(route.request().url()).pathname)), contentType: 'text/javascript',
  }));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const realFile = process.env.EMAP_SCHEDULING_FILE;
  if (realFile) await page.locator('#file-input').setInputFiles(realFile);
  const result = await page.evaluate(async hasFile => {
    const { openGeoTIFF } = await import('../emap-geotiff.mjs');
    const MIB = 1024 ** 2;
    const runtime = emap.createEmapWorkerRuntime({ urls: { geotiff: new URL('../emap-geotiff-worker.js', location.href).href }, sizes: { geotiff: 2 } });
    const sources = [], phases = [];
    const file = hasFile ? document.querySelector('#file-input').files[0]
      : new File([await (await fetch('../fixtures/example-geotiff.tif')).blob()], 'fixture.tif');
    const request = { level: 0, window: [0, 0, 32, 32], samples: [0] };
    let expected, initial;
    const read = async () => {
      const results = await Promise.all(sources.map(source => source.readWindow(request)));
      const arrays = results.map(r => Array.from(r.data[0]));
      expected ??= arrays[0];
      if (arrays.some(a => a.some((v, i) => v !== expected[i]))) throw Error('Samples changed after cache maintenance');
      return results.map(r => ({ limit: r.diagnostics.blockCacheLimitBytes / MIB, hits: r.diagnostics.blockCacheHits, misses: r.diagnostics.blockCacheMisses, fileReadBytes:r.diagnostics.fileReadBytes, workerMs:r.diagnostics.workerMs }));
    };
    try {
      for (let i = 0; i < 2; i++) sources.push(await openGeoTIFF(file, { workerRuntime: runtime, workerCount: 1, blockCacheBytes: 32 * MIB }));
      initial = await read();
      for (let cycle = 0; cycle < 2; cycle++) {
        const shrunk = await runtime.setMemoryPressure('moderate');
        if (shrunk.failures.length) throw Error(JSON.stringify(shrunk.failures));
        phases.push({ phase: 'pressure', reads: await read() });
        await runtime.setMemoryPressure('normal');
        phases.push({ phase: 'restored', reads: await read() });
        phases.push({ phase: 'warm', reads: await read() });
      }
      await runtime.resizePool('geotiff', { cacheBytes: 130 * MIB });
      phases.push({ phase: 'partial', reads: await read() });
      await runtime.resizePool('geotiff', { cacheBytes: 256 * MIB });
      phases.push({ phase: 'restored', reads: await read() });
      // The reader floor prevents a zero-capacity worker resize. Even when
      // native maintenance cannot reach that target, reads must not regrow it.
      const critical = await runtime.setMemoryPressure('critical');
      if (!critical.failures.length) throw Error('Expected pinned reader floor');
      phases.push({ phase: 'pressure', reads: await read() });
      await runtime.setMemoryPressure('normal');
      phases.push({ phase: 'restored', reads: await read() });
    } finally {
      for (const source of sources) source.dispose();
      await Promise.all(sources.map(source => source.settled));
      await runtime.dispose();
    }
    return { initial, phases, workers: runtime.stats.workers, resident: runtime.stats.reserved.residentBytes, leases: runtime.stats.resourceLeases };
  }, !!realFile);
  console.log('CACHE_RECOVERY', JSON.stringify(result));
  for (const initial of result.initial) { expect(initial.limit).toBeGreaterThan(2); expect(initial.limit).toBeLessThanOrEqual(32); }
  for (const { phase, reads } of result.phases) for (const [index, read] of reads.entries()) {
    expect(read.limit, phase).toBe(phase === 'pressure' ? 0 : phase === 'partial' ? 2 : result.initial[index].limit);
    if (phase === 'warm') { expect(read.hits).toBeGreaterThan(0); expect(read.misses).toBe(0); }
  }
  expect(result).toMatchObject({ workers: 0, resident: 0, leases: 0 });
});

test('compare spatial and cache-aware scheduling on the same raster windows', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route(/\/(?:emap[^/]*|mapshaper-vendor)\.mjs$/, route => route.fulfill({
    path: resolve('dist', basename(new URL(route.request().url()).pathname)), contentType: 'text/javascript',
  }));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const file = process.env.EMAP_SCHEDULING_FILE;
  if (file) await page.locator('#file-input').setInputFiles(file);
  const results = await page.evaluate(async hasFile => {
    const { openGeoTIFF } = await import('../emap-geotiff.mjs');
    const file = hasFile ? document.querySelector('#file-input').files[0]
      : new File([await (await fetch('../fixtures/example-geotiff.tif')).blob()], 'fixture.tif');
    const rows = [];
    // Alternate order so the second mode does not always inherit warmer OS file caches.
    for (let round = 0; round < 3; round++) for (const scheduling of round % 2
      ? ['cache-aware', 'spatial'] : ['spatial', 'cache-aware']) {
      const runtime = emap.createEmapWorkerRuntime({ urls: {
        geotiff: new URL('../emap-geotiff-worker.js', location.href).href,
      }, sizes: { geotiff: 2 } });
      let source;
      try {
        source = await openGeoTIFF(file, { workerRuntime: runtime, workerCount: 2, workerScheduling: scheduling });
        const level = source.metadata.levels.find(l => l.tileWidth < l.width && l.tileHeight <= 512) ?? source.metadata.levels[0];
        // Include single-column skew and mixed-column navigation; preserve identical requests.
        const requests = Array.from({ length: 12 }, (_, i) => {
          const x = i < 6 ? 0 : Math.min(level.width - 1, (i % 3) * level.tileWidth);
          const y = Math.min(level.height - 1, (i % 6) * level.tileHeight);
          return { level: level.id, window: [x, y, Math.min(level.width, x + 128), Math.min(level.height, y + 128)], samples: [0] };
        });
        // Wait for replica metadata; do not attribute asynchronous open to decode throughput.
        const deadline = performance.now() + 30_000;
        while (runtime.diagnostics().pools.find(p => p.name === 'geotiff').resources.length < 2) {
          if (performance.now() > deadline) throw Error('Replica did not open');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        for (const phase of ['cold', 'warm']) {
          const pool = () => runtime.diagnostics().pools.find(p => p.name === 'geotiff');
          const before = pool().resourceCacheStats, start = performance.now();
          let firstMs;
          const results = await Promise.all(requests.map(async request => {
            const result = await source.readWindow(request); firstMs ??= performance.now() - start;
            return result;
          }));
          const ms = performance.now() - start, after = pool();
          const hashes = await Promise.all(results.map(async result => {
            const band = result.data[0];
            const digest = await crypto.subtle.digest('SHA-256', band);
            return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
          }));
          rows.push({ round, scheduling, phase, ms, firstMs, hashes,
            hits: after.resourceCacheStats.hits - before.hits,
            misses: after.resourceCacheStats.misses - before.misses,
            fileReadBytes: results.reduce((n, r) => n + (r.diagnostics?.fileReadBytes ?? 0), 0),
            keys: after.resources.map(r => r.keys.length), stats: source.getProcessingStats(),
          });
        }
      } finally { source?.dispose(); await source?.settled; await runtime.dispose(); }
      if (runtime.stats.workers || runtime.stats.resourceLeases || runtime.stats.reserved.residentBytes)
        throw Error('Reader resources not released');
    }
    return rows;
  }, Boolean(file));
  expect(results).toHaveLength(12);
  for (const row of results) {
    expect(row.hashes).toEqual(results[0].hashes);
    expect(row.keys.every(count => count <= 128)).toBe(true);
    expect(row.keys.some(count => count > 0)).toBe(true);
    expect(row.stats.reservedBytes).toBe(0);
    expect(row.stats.busyWorkers).toBe(0);
  }
  expect(errors).toEqual([]);
  console.log('RASTER_SCHEDULING', JSON.stringify(results.map(({ hashes, stats, ...row }) => row)));
  if (process.env.EMAP_SCHEDULING_OUT) await writeFile(process.env.EMAP_SCHEDULING_OUT, JSON.stringify({ file, results, errors }, null, 2));
});

for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) test(`${renderer}: cache-aware navigation retains imagery and returns identical pixels`, async ({ page, browserName }) => {
  test.skip(renderer === 'webgpu' && browserName !== 'chromium', 'WebGPU coverage runs in Chrome.');
  test.setTimeout(180_000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await installCanvasReadback(page);
  await page.goto(`/mapseekai/emap/examples/geotiff-viewer/?renderer=${renderer}`);
  await page.waitForFunction(() => window.geotiffDemo?.metadata && !window.geotiffDemo.loading);
  await page.evaluate(() => {
    const loader = geotiffDemo.map.ctx.geoTIFF, add = loader.addFile;
    loader.addFile = (id, file, options) => add(id, file, { ...options, workerScheduling: 'cache-aware' });
  });
  if (process.env.EMAP_SCHEDULING_FILE) await page.locator('#file-input').setInputFiles(process.env.EMAP_SCHEDULING_FILE);
  else await page.evaluate(() => geotiffDemo.load(geotiffDemo.file));
  const result = await page.evaluate(async () => {
    const demo = geotiffDemo;
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    const idle = async () => {
      let stable = 0;
      const start = performance.now();
      while (stable < 4) {
        await frame();
        if (demo.error) throw Error(demo.error);
        const s = demo.stats(), p = demo.processing();
        stable = !demo.loading && !s.activeReads && !s.queuedReads && !s.pendingFrames &&
          !s.interacting && !p?.busyWorkers && !p?.queuedTasks && !p?.reservedBytes ? stable + 1 : 0;
        if (performance.now() - start > 60_000) throw Error('Navigation did not settle');
      }
    };
    const capture = async () => {
      // Match the renderer regression harness: snapshot a freshly rendered GPU texture.
      demo.map.render();
      const pixels = await Promise.all([...document.querySelectorAll('#map canvas')].map(readCanvasPixels));
      let painted = 0;
      for (const data of pixels) for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
      const hashes = await Promise.all(pixels.map(async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].join(',')));
      return { painted, hashes };
    };
    await idle();
    const initial = await capture(), view = demo.map.ctx.view, center = view.getCenter(), scale = Math.abs(view.getTransform().mx);
    const samples = [];
    for (const zoom of [2, 4, 8, 16, 8, 4, 2, 1]) {
      view.jumpTo({ center, scale: scale * zoom });
      await frame(); const during = await capture();
      await idle(); const after = await capture();
      samples.push({ zoom, during: during.painted, after: after.painted });
    }
    const final = await capture();
    const selectedRenderer = demo.map.getRenderer();
    await demo.map.dispose();
    return { initial, final, samples, renderer: selectedRenderer, error: demo.error };
  });
  expect(result.renderer).toBe(renderer);
  expect(result.initial.painted).toBeGreaterThan(1000);
  expect(result.final.hashes).toEqual(result.initial.hashes);
  for (const sample of result.samples) {
    expect(sample.during).toBeGreaterThan(1000);
    expect(sample.after).toBeGreaterThan(1000);
  }
  expect(result.error).toBeNull(); expect(errors).toEqual([]);
  await expect.poll(() => page.workers().length).toBe(0);
});
