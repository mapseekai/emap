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
      const painter=cacheMap.ctx.render._painter,finish=painter.finishFrame,lookup=painter._fillPathCache;
      let frames=0,cacheLookups=0,immediateLookups=0,passes=0,retainPaths=true;
      painter.finishFrame=function(...args){const result=finish.apply(this,args);frames++;return result;};
      // Returning a cache object counts a lookup, not a states 1/2/3 replay hit.
      painter._fillPathCache=function(...args){const result=retainPaths?lookup.apply(this,args):undefined;if(result)cacheLookups++;else immediateLookups++;return result;};
      const r=cacheMap.ctx.render,p=r._painter;
      const capture = async (mode,captures) => {
          const before={frames,cacheLookups,immediateLookups,passes};cacheMap.render();
          const yielded=!p.frameComplete,deadline=performance.now()+30_000;
          // A cooperative frame keeps the old display image until its RAF jobs
          // finish. Observe this render's finish call before reading its pixels.
          while(frames<=before.frames||!p.frameComplete||r._pendingRender||r._rafId){
            if(performance.now()>deadline)throw Error('Canvas frame did not finish');
            await new Promise(requestAnimationFrame);
          }
          const pixels=await readCanvasPixels(r._canvas);
          const observed={mode,yielded,frames:frames-before.frames,cacheLookups:cacheLookups-before.cacheLookups,immediateLookups:immediateLookups-before.immediateLookups,complete:p.frameComplete,cooperative:p._cooperative,staging:!!p._staging,passes:passes-before.passes};
          if(mode.startsWith('cooperative'))Object.assign(observed,pixelStats(pixels));
          captures.push(observed);
          return pixels;
        };
      const pixelStats=pixels=>{let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0&&Math.max(pixels[i],pixels[i+1],pixels[i+2])-Math.min(pixels[i],pixels[i+1],pixels[i+2])>20)colored++;return {painted:pixels.some((v,i)=>i%4===3&&v>0),colored};};
      window.verifyCooperative = async () => {
        const captures=[];await capture('cooperative',captures);await capture('cooperative-replay',captures);
        const states={};for(const cache of p._fillPathCaches.values())for(const state of cache.states)states[state]=(states[state]??0)+1;
        return {painted:captures.every(c=>c.painted),colored:Math.min(...captures.map(c=>c.colored)),captures,entries:p._fillPathCaches.size,bytes:p._fillPathBytes,states};
      };
      // Chrome rasterizes identical transparent native commands differently at
      // different RAF flush boundaries. Compare cache equivalence under the same
      // synchronous custom-pass contract; default cooperative paint is checked first.
      window.comparableCacheSubmission=()=>r.registerPass(()=>{passes++;});
      window.verifyCache = async () => {
        const captures=[];
        const retained = await capture('retained',captures);
        // Bypass only path retention to use the original immediate Canvas path.
        p.clearGeometryCache();retainPaths=false;
        let expected;
        try { expected = await capture('immediate',captures); } finally { retainPaths=true; }
        let changes = retained.reduce((n, v, i) => n + Number(v !== expected[i]), 0);
        for (let i = 0; i < 3; i++) {
          const actual = await capture('replay',captures);
          for (let j = 0; j < actual.length; j++) changes += Number(actual[j] !== expected[j]);
        }
        return { changes, entries:p._fillPathCaches.size, bytes:p._fillPathBytes,...pixelStats(expected),captures };
      };
    });
    const cooperative=await page.evaluate(async()=>{cacheMap.setExtent(new emap.Bounds(-3.5,-3,3.5,3));return verifyCooperative();});
    expect(cooperative.captures.every(c=>c.frames>0&&c.complete&&c.yielded&&c.cooperative&&c.staging&&c.cacheLookups>0&&c.passes===0&&c.painted&&c.colored>0)).toBe(true);
    expect(cooperative.painted).toBe(true);expect(cooperative.colored).toBeGreaterThan(0);expect(cooperative.entries).toBeGreaterThan(0);expect(cooperative.bytes).toBeLessThanOrEqual(32*1024**2);
    console.log('CANVAS_COOPERATIVE',JSON.stringify({dpr,...cooperative}));
    await page.evaluate(()=>comparableCacheSubmission());
    const verify=async detail=>{
      const result=await page.evaluate(()=>verifyCache());
      expect(result.changes,JSON.stringify({dpr,...detail,...result})).toBe(0);
      expect(result.painted).toBe(true);expect(result.colored).toBeGreaterThan(0);expect(result.entries).toBeGreaterThan(0);
      expect(result.bytes).toBeLessThanOrEqual(32*1024**2);
      expect(result.captures.every(c=>c.frames>0&&c.complete&&c.passes>0&&!c.cooperative)).toBe(true);
      expect(result.captures.filter(c=>c.mode==='immediate').every(c=>c.immediateLookups>0&&c.cacheLookups===0)).toBe(true);
      expect(result.captures.filter(c=>c.mode!=='immediate').every(c=>c.cacheLookups>0)).toBe(true);
      console.log('CANVAS_CACHE_FRAME',JSON.stringify({dpr,...detail,...result}));
    };
    for (const factor of [1,2,4,8,16,8,4,2,1,.5,1]) {
      await page.evaluate(factor => { cacheMap.setExtent(new emap.Bounds(-3.5/factor,-3/factor,3.5/factor,3/factor)); }, factor);
      await verify({factor});
    }
    for (const mutation of ['paint','filter','restore']) {
      await page.evaluate(mutation => {
        if (mutation === 'paint') cacheMap.setPaintProperty('fills','fill-opacity',.2);
        else cacheMap.setFilter('fills', mutation === 'filter' ? ['==',['get','group'],0] : null);
      }, mutation);
      await verify({mutation});
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
