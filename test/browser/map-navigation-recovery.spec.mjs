import { test, expect } from '@playwright/test';

for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) {
  test(`${renderer}: 199 labeled points retain slow navigation snapshots with 20 hidden layers`, async ({ page }, info) => {
    test.setTimeout(120000);
    await page.goto('/mapseekai/emap/examples/luma-benchmark/');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    await page.evaluate(async (renderer) => {
      lumaBenchmark.dispose();
      document.body.replaceChildren();
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
      document.body.append(host);
      const map = window.recoveryMap = await emap.Emap.create({ container: host, renderer });
      window.recoveryErrors = [];
      map.on('error', (event) => recoveryErrors.push(String(event.error)));
      const add = async (id, count) => {
        const source = new emap.TopologySource(id);
        const features = Array.from({ length: count }, (_, i) => ({
          type: 'Feature', properties: { name: `P${i}`, group: i % 3 },
          geometry: { type: 'Point', coordinates: [(i % 20) * 4, Math.floor(i / 20) * 4] },
        }));
        await source.setData({ filename: `${id}.geojson`, content: new TextEncoder().encode(JSON.stringify({ type: 'FeatureCollection', features })) });
        await map.addSource(id, source);
      };
      await add('hidden', 50000);
      for (let i = 0; i < 20; i++) map.addLayer({ id: `hidden-${i}`, source: 'hidden', type: 'circle', layout: { visibility: 'none' } });
      await add('places', 199);
      map.addLayer({
        id: 'places', source: 'places', type: 'circle',
        paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'group'], 0, '#e34850', 1, '#288bd2', '#37ac60'] },
        label: { field: 'name', fontSize: 12, maxLabels: 199, allowOverlap: true },
      });
      // Keep every glyph box inside the viewport throughout the camera scales.
      map.setExtent(new emap.Bounds(-10, -5, 90, 45));
      map.render();
      await map.ctx.render._labels.settled();
      map.render();
      await map.ctx.render._painter.gpu?.waitForIdle();
    }, renderer);
    await page.waitForFunction(() => recoveryMap.ctx.render._labels.stats.placed > 0);
    await page.waitForFunction(() => recoveryMap.ctx.render._pendingRender === 0);
    const result = await page.evaluate(async () => {
      const map = recoveryMap, r = map.ctx.render, p = r._painter, v = map.ctx.view._viewport;
      const startView = v.transform.clone();
      const glyphSizes = r._labels.preview(v.transform, v.width, v.height).labels.map((l) => [l.raster.width, l.raster.height]);
      // Seed a single old CPU sample without adding persistent load. No engine methods are mocked.
      r._scheduler.recordFrame(p.renderNavigation ? 100 : 5, r._captureRenderSnapshot());
      const before = { ...p.stats?.presentation };
      let frames = 0, css = 0;
      r.beginNavigation();
      r.render({ action: 'nav', navDelta: r._computeNavDelta() });
      const initialSnapshot = !!r._canvas.style.transform;
      for (let i = 0; i < 90; i++) {
        v.transform.scale(1.001, 400, 300);
        r.updateNavigation();
        await new Promise(requestAnimationFrame);
        frames++;
        if (r._canvas.style.transform) css++;
      }
      const during = { frames, css, initialSnapshot,
        replays: (p.stats?.presentation?.replays ?? 0) - (before.replays ?? 0),
        full: (p.stats?.presentation?.presented ?? 0) - (before.presented ?? 0),
        active: r._navSnapshotTransform !== null };
      const previewSizes = r._labels.preview(v.transform, v.width, v.height).labels.map((l) => [l.raster.width, l.raster.height]);
      r.endNavigation();
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      const final = { transform: r._canvas.style.transform, painted: { ...r._paintedTransform }, view: { ...v.transform }, timing: p.stats?.navigationTiming };
      Object.assign(v.transform, startView);
      r.render();
      await map.dispose();
      return { during, final, glyphSizes, previewSizes, errors: recoveryErrors, pendingAfterDispose: p.navigationPending ?? false };
    });
    await info.attach('navigation-recovery', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
    console.log(renderer, JSON.stringify({ during: result.during, final: result.final }));
    expect(result.during.active).toBe(true);
    if (renderer === 'canvas2d') expect(result.during.css).toBe(0);
    else {
      expect(result.during.initialSnapshot).toBe(true);
      expect(result.during.replays).toBe(0);
      expect(result.during.full).toBe(0);
      expect(result.during.css).toBe(result.during.frames);
    }
    expect(result.previewSizes).toEqual(result.glyphSizes);
    expect(result.final.transform).toBe('');
    for (const key of ['mx', 'my', 'bx', 'by']) expect(result.final.painted[key]).toBeCloseTo(result.final.view[key], 8);
    expect(result.pendingAfterDispose).toBe(false);
    expect(result.errors).toEqual([]);
  });
}
