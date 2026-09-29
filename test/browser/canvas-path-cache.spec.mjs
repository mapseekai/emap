import { test, expect } from '@playwright/test';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';

for (const dpr of [1, 1.25, 2]) test(`Canvas exact path replay and invalidation at DPR ${dpr}`, async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await installCanvasReadback(page);
    await page.goto('/mapseekai/emap/examples/luma-benchmark/');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    await page.evaluate(async () => {
      lumaBenchmark.dispose(); document.body.replaceChildren();
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.append(host);
      window.cacheMap = await emap.Emap.create({ container: host, renderer: 'canvas2d', preset: 'viewer' });
      const features = Array.from({ length: 3000 }, (_, i) => {
        const x = (i % 60) * .1 - 3, y = Math.floor(i / 60) * .1 - 2.5;
        const ring = (a, b, size) => [[a,b],[a+size,b],[a+size,b+size],[a,b+size],[a,b]];
        return { type: 'Feature', properties: { group: i % 2 }, geometry: { type: 'MultiPolygon', coordinates: [
          [ring(x,y,.15), ring(x+.03,y+.03,.04)],
          [ring(x+.16,y,.025)],
          // Degenerate and subpixel rings must retain original edge coverage.
          [[[x,y],[x+.2,y+.2],[x,y]]],
          [ring(x-.00001,y-.00001,.00001)],
        ] } };
      });
      features.push(...Array.from({ length: 3000 }, (_, i) => {
        const x=(i%60)*.1-2.973, y=Math.floor(i/60)*.1-2.471, e=.00001;
        return {type:'Feature',properties:{group:i%2},geometry:{type:'Polygon',coordinates:[[[x,y],[x+e,y],[x+e,y+e],[x,y+e],[x,y]]]}};
      }));
      const source = new emap.TopologySource('cached');
      await source.setData({ filename: 'cache.geojson', content: new TextEncoder().encode(JSON.stringify({ type:'FeatureCollection', features })) });
      source.getDisplayArcs = () => null;
      await cacheMap.addSource('cached', source);
      cacheMap.addLayer({ id:'fills', type:'fill', source:'cached', 'source-layer':source.getLayers()[0].name,
        paint: { 'fill-color':['match',['get','group'],0,'#185acb','#cb4518'], 'fill-opacity': .45 } });
      window.verifyCache = async () => {
        const p = cacheMap.ctx.render._painter, setContext = p.setLayerContext;
        const capture = async () => { cacheMap.render(); return readCanvasPixels(cacheMap.ctx.render._canvas); };
        const retained = await capture();
        // Bypass only path retention to use the original immediate Canvas path.
        p.clearGeometryCache(); p.setLayerContext = function () { setContext.call(this, null); };
        const expected = await capture();
        p.setLayerContext = setContext;
        let changes = retained.reduce((n, v, i) => n + Number(v !== expected[i]), 0);
        for (let i = 0; i < 3; i++) {
          const actual = await capture();
          for (let j = 0; j < actual.length; j++) changes += Number(actual[j] !== expected[j]);
        }
        return { changes, entries:p._fillPathCaches.size, bytes:p._fillPathBytes, painted:expected.some((v,i) => i%4===3 && v>0) };
      };
    });
    for (const factor of [1,2,4,8,16,8,4,2,1,.5,1]) {
      await page.evaluate(factor => { cacheMap.setExtent(new emap.Bounds(-3.5/factor,-3/factor,3.5/factor,3/factor)); }, factor);
      const result = await page.evaluate(() => verifyCache());
      expect(result.changes, JSON.stringify({ factor, dpr })).toBe(0);
      expect(result.painted).toBe(true); expect(result.entries).toBeGreaterThan(0);
      expect(result.bytes).toBeLessThanOrEqual(32*1024**2);
    }
    for (const mutation of ['paint','filter','restore']) {
      await page.evaluate(mutation => {
        if (mutation === 'paint') cacheMap.setPaintProperty('fills','fill-opacity',.2);
        else cacheMap.setFilter('fills', mutation === 'filter' ? ['==',['get','group'],0] : null);
      }, mutation);
      expect((await page.evaluate(() => verifyCache())).changes).toBe(0);
    }
    expect(await page.evaluate(async () => {
      const p=cacheMap.ctx.render._painter;
      cacheMap.removeSource('cached'); cacheMap.render();
      const empty=p._fillPathCaches.size===0 && p._fillPathBytes===0;
      await cacheMap.dispose(); return empty && p._fillPathCaches.size===0;
    })).toBe(true);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
