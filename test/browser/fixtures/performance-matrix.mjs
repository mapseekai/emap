// Browser probe for the formal map, shared by the three rendering backends.
// Importing GeoJSON uses the existing streaming File worker; rendering uses Emap.
import { importBenchmarkFile } from '../../../packages/examples/src/luma-benchmark/import-file.ts';

const tick = () => new Promise(requestAnimationFrame);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: values.length,
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? null,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? null,
    max: sorted.at(-1) ?? null,
  };
};

window.installMatrixProbe = async () => {
  const state = window.geopackageDemo;
  const map = state.map;
  const render = map.ctx.render;
  const painter = render._painter;
  const probe = (window.matrixProbe = {
    map,
    phase: 'idle',
    phaseStats: {},
    longTasks: [],
    progress: '',
    ready: false,
    error: null,
    mapErrors: [],
    load: {},
  });
  const css = document.createElement('style');
  css.textContent = `html,body {margin:0!important;overflow:hidden!important} #map {position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important} body > :not(#map):not(script):not(style) {display:none!important} #map .emap-control-container {display:none!important}`;
  document.head.append(css);
  map.resize();
  await tick();
  await tick();

  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      probe.longTasks.push({ start: entry.startTime, duration: entry.duration, phase: probe.phase });
    }
  }).observe({ type: 'longtask', buffered: false });
  const measure = (name) => {
    const original = render[name].bind(render);
    render[name] = (...args) => {
      const t = performance.now();
      try {
        return original(...args);
      } finally {
        const phase = (probe.phaseStats[probe.phase] ??= { full: [], navigation: [], blankPartial: 0, partial: 0, complete: 0 });
        phase[name === '_renderFull' ? 'full' : 'navigation'].push(performance.now() - t);
        if (name === '_renderFull' && probe.load.start !== undefined && state.dataset === probe.dataset) {
          if (probe.load.firstFrameMs === undefined) probe.load.firstFrameMs = performance.now() - probe.load.start;
          if (painter.frameComplete !== false && probe.load.completeFrameMs === undefined) {
            probe.load.completeFrameMs = performance.now() - probe.load.start;
          }
        }
      }
    };
  };
  measure('_renderFull');
  measure('_applyFastTransform');
  if (painter.finishFrame && painter.stats) {
    const finish = painter.finishFrame.bind(painter);
    painter.finishFrame = () => {
      const frames = painter.stats.frames;
      const draws = painter.stats.drawCalls;
      finish();
      if (painter.stats.frames === frames) return;
      const phase = (probe.phaseStats[probe.phase] ??= { full: [], navigation: [], blankPartial: 0, partial: 0, complete: 0 });
      if (painter.frameComplete) phase.complete++;
      else {
        phase.partial++;
        if (painter.stats.drawCalls === draws) phase.blankPartial++;
      }
    };
  }
  map.on('error', (event) => {
    probe.error = String(event.error ?? event);
    probe.mapErrors.push({ phase: probe.phase, at: performance.now(), error: probe.error });
  });

  const settled = () =>
    painter.frameComplete !== false &&
    !(painter.stats?.geometryChunks?.pending > 0) &&
    render._pendingRender === 0 &&
    render._navSnapshotTransform === null;
  probe.settle = async () => {
    const start = performance.now();
    let quiet = 0;
    while (quiet < 3) {
      await tick();
      if (probe.error || state.error || painter.stats?.geometryChunks?.failedEntries || painter.stats?.geometryChunks?.failedRequests) throw new Error(probe.error ?? state.error ?? 'Geometry worker error');
      quiet = settled() ? quiet + 1 : 0;
      if (performance.now() - start > 120000) throw new Error('View failed to settle within 120 seconds');
    }
    await painter.gpu?.waitForIdle();
    return performance.now() - start;
  };
  probe.snapshot = () => ({
    backend: map.getRenderer(),
    dimensions: { width: map.ctx.view._viewport.width, height: map.ctx.view._viewport.height, dpr: devicePixelRatio },
    transform: map.getTransform(),
    complete: settled(),
    features: state.source?.getLayers().reduce((n, layer) => n + (layer.shapes?.length ?? 0), 0),
    layers: state.source?.getLayers().map((layer) => ({ name: layer.name, kind: layer.geometry_type, count: layer.shapes?.length ?? 0 })),
    tables: state.dataset?.info?.geopackage?.tables.map((table) => ({ table: table.table, rows: table.rows })),
    arcs: state.source?.getArcs()?.size(),
    vertices: state.source?.getArcs()?.getPointCount(),
    stats: painter.stats ?? null,
    memory: painter.gpu?.memoryStats ?? null,
    heap: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize, limit: performance.memory.jsHeapSizeLimit } : null,
    mapErrors: probe.mapErrors,
  });
  probe.residency = () => {
    const cache = painter.chunks;
    if (!cache) return null;
    const requests = [...cache.requests.values()].filter((r) => r.frame === cache.frame);
    const wanted = new Set(requests.flatMap((r) => r.entries ?? []));
    const drawable = new Set(requests.flatMap((r) => cache.drawable(r)));
    const entries = [...cache.entries.values()];
    const sum = (values) => [...values].reduce((n, e) => n + e.bytes, 0);
    return { bytes: cache.bytes, externalBytes: cache.externalBytes, limit: cache.limit, wantedBytes: sum(wanted), drawableBytes: sum(drawable), pinnedBytes: sum(cache.pinned), fallbackOnlyBytes: sum(entries.filter((e) => !wanted.has(e) && (drawable.has(e) || cache.pinned.has(e)))), blocked: entries.filter((e) => e.state === 'error').map((e) => ({ bytes: e.bytes, requiredBytes: e.requiredBytes, error: String(e.error) })) };
  };
  probe.loadFile = async (file) => {
    probe.phase = 'load';
    probe.load = { start: performance.now(), bytes: file.size };
    try {
      if (file.name.toLowerCase().endsWith('.gpkg')) {
        const bytes = await file.arrayBuffer();
        probe.load.readMs = performance.now() - probe.load.start;
        await state.load(bytes, file.name);
        if (state.error) throw new Error(state.error);
        probe.dataset = state.dataset;
      } else {
        const imported = await importBenchmarkFile(file, new AbortController().signal, (value) => { probe.progress = value; });
        probe.load.parseMs = performance.now() - probe.load.start;
        imported.source.close();
        const source = new emap.TopologySource('gpkg');
        source.setDataset(imported.dataset, false);
        map.removeSource('gpkg');
        await map.addSource('gpkg', source);
        state.source = source;
        state.dataset = source.getDataset();
        probe.dataset = state.dataset;
        for (const [index, layer] of source.getLayers().entries()) {
          const type = layer.geometry_type === 'point' ? 'circle' : layer.geometry_type === 'polygon' ? 'fill' : layer.geometry_type === 'polyline' ? 'line' : null;
          if (!type) continue;
          const paint = type === 'fill' ? { 'fill-color': '#77ad8b', 'fill-opacity': 0.45 } : type === 'line' ? { 'line-color': '#446bcb', 'line-width': 3 } : { 'circle-color': '#dc7a33', 'circle-radius': 6 };
          map.addLayer({ id: `gpkg-${index}`, source: 'gpkg', 'source-layer': layer.name, type, paint });
        }
      }
      probe.load.importMs = performance.now() - probe.load.start;
      map.fitBounds(state.source.getExtent(), { padding: 35, duration: 0 });
      map.render();
      await probe.settle();
      probe.load.readyMs = performance.now() - probe.load.start;
      probe.fit = map.getTransform();
      probe.ready = true;
      probe.phase = 'idle';
    } catch (error) {
      probe.error = String(error);
    }
  };
  probe.sample = async ({ frames, zoom, label, duration = 1200 }) => {
    const result = { label, zoom, fromZoom: Math.abs(map.getTransform().mx / probe.fit.mx) };
    // Preserve errors in mapErrors, but let a subsequent view test recovery.
    probe.error = null;
    probe.phase = `${label}:navigation`;
    const start = performance.now();
    const currentScale = Math.abs(map.getTransform().mx);
    const targetScale = Math.abs(probe.fit.mx) * zoom;
    if (Math.abs(currentScale / targetScale - 1) > 1e-9) {
      let ended = false;
      const onEnd = () => { ended = true; };
      map.on('moveend', onEnd);
      const intervals = [];
      let previous = await tick();
      map.easeTo({ scale: targetScale, duration });
      while (!ended) {
        const now = await tick();
        intervals.push(now - previous);
        previous = now;
        if (performance.now() - start > 120000) throw new Error('Camera animation failed to complete');
      }
      map.off('moveend', onEnd);
      const elapsedMs = performance.now() - start;
      result.navigation = {
        intervals, frameMs: summary(intervals), elapsedMs,
        // All callbacks in one rAF batch share a timestamp. A slow final camera
        // render must still count, even when it runs before our callback.
        fps: intervals.length * 1000 / elapsedMs,
        rafFps: intervals.length * 1000 / intervals.reduce((a, b) => a + b, 0),
      };
    }
    result.settleAfterAnimationMs = await probe.settle();
    result.transitionMs = performance.now() - start;
    result.transitionStats = probe.phaseStats[probe.phase] ?? null;
    result.zoomObserved = Math.abs(map.getTransform().mx / probe.fit.mx);
    if (Math.abs(result.zoomObserved / zoom - 1) > 1e-6) throw new Error(`Zoom mismatch: ${result.zoomObserved} vs ${zoom}`);

    probe.phase = `${label}:warmup`;
    for (let i = 0; i < 8; i++) { await tick(); map.render(); }
    await probe.settle();
    probe.phase = `${label}:redraw`;
    const times = [], intervals = [];
    const before = { ...painter.stats };
    let previous = await tick();
    const redrawStarted = performance.now();
    for (let i = 0; i < frames; i++) {
      const t = performance.now();
      map.render();
      times.push(performance.now() - t);
      const now = await tick();
      intervals.push(now - previous);
      previous = now;
    }
    await painter.gpu?.waitForIdle();
    const completionMs = performance.now() - redrawStarted;
    result.redraw = {
      cpuMs: summary(times), frameMs: summary(intervals), times, intervals,
      fps: frames * 1000 / intervals.reduce((a, b) => a + b, 0),
      completionMs,
      completionFps: frames * 1000 / completionMs,
      drawCallsPerFrame: painter.stats ? (painter.stats.drawCalls - before.drawCalls) / frames : null,
      uploadedBytes: painter.stats ? painter.stats.uploadedBytes - before.uploadedBytes : null,
      incompleteFrames: probe.phaseStats[probe.phase]?.partial ?? 0,
      longTasks: probe.longTasks.filter((task) => task.phase === probe.phase),
    };
    result.state = probe.snapshot();
    probe.phase = `${label}:gpu-timing`;
    const gpu = painter.gpu;
    result.gpu = { timestampSupported: !!gpu?.timestampSupported, milliseconds: [] };
    if (gpu?.timestampSupported) {
      gpu.enableTiming(true);
      try {
        for (let i = 0; i < 8; i++) {
          await tick();
          const n = gpu.gpuTimings.length;
          map.render();
          await gpu.waitForIdle();
          const deadline = performance.now() + 500;
          while (gpu.gpuTimings.length === n && performance.now() < deadline) await pause(2);
          if (gpu.gpuTimings.length > n) result.gpu.milliseconds.push(gpu.gpuTimings.at(-1));
        }
        result.gpu.summary = summary(result.gpu.milliseconds);
      } finally { gpu.enableTiming(false); }
    }
    probe.phase = 'idle';
    return result;
  };
  // Pixel validation is outside timed samples: readback can synchronize/stall the GPU.
  probe.pixels = async () => {
    map.render();
    const bitmap = await createImageBitmap(render._canvas);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonTransparent = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) nonTransparent++;
    return { nonTransparent, totalPixels: pixels.length / 4 };
  };
};
