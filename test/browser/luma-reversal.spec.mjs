import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { resolve } from 'node:path';
const bundle = resolve('test-results/.line-fixtures/reversal.js');
test.beforeAll(async () => {
  await build({ entryPoints: [resolve('test/browser/fixtures/luma-reversal.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'es2022', outfile: bundle, define: { 'process.env.NODE_ENV': '"production"' } });
});
for (const backend of ['webgl', 'webgpu']) for (const dpr of [1, 1.25, 2]) {
  test(`${backend} DPR ${dpr}: exact reversals preserve the independent round-stroke footprint`, async ({ page }) => {
    test.setTimeout(180000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/mapseekai/emap/examples/luma-benchmark/');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    await page.evaluate(() => window.lumaBenchmark.dispose());
    await page.addScriptTag({ path: bundle });
    for (const scenario of ['closed', 'caps', 'open', 'tiny', 'precise']) {
      for (const width of scenario === 'caps' ? [256] : [.6, 2, 7]) {
        const result = await page.evaluate(options => window.verifyReversalPixels(options), { backend, dpr, width, scenario });
        expect(result.actualBackend).toBe(backend);
        expect(result.samples).toBe(4);
        expect(result.errors).toEqual([]);
        expect(result.liveBufferBytes).toBe(0);
        for (const row of result.rows) {
          expect(row.compact).toBe(row.mode !== 'raw');
          expect(row.submitted).toBeGreaterThan(0);
          if (scenario === 'closed' && row.mode === 'compact') expect(row.xy).toBe(true);
          if (row.mode === 'compact-hi-lo') expect(row.xy).toBe(false);
          expect(row.painted, JSON.stringify({ scenario, width, row })).toBeGreaterThan(0);
          expect(row.missing, JSON.stringify({ scenario, width, row })).toBe(0);
          expect(row.extra, JSON.stringify({ scenario, width, row })).toBe(0);
          if (scenario === 'closed') {
            expect(row.bodyCompared).toBeGreaterThan(0);
            expect(row.bodyDifferent, JSON.stringify({ scenario, width, dpr, row })).toBe(0);
          }
          if (scenario === 'caps') for (const alpha of row.wedge) expect(alpha).toBe(255);
        }
      }
    }
    for (const { scale, shift, angle } of [{ scale: .4, shift: -.375, angle: Math.PI / 2 }, { scale: 1.8, shift: .125, angle: -.4 }]) {
      const result = await page.evaluate(options => window.verifyReversalPixels(options), { backend, dpr, width: 7, scale, shift, angle });
      expect(result.errors).toEqual([]);
      for (const row of result.rows) {
        expect(row.interior).toBeGreaterThan(0);
        expect(row.missing).toBe(0);
        expect(row.extra).toBe(0);
      }
    }
    expect(errors).toEqual([]);
  });
}

for(const backend of ['webgl','webgpu'])test(`${backend}: capsule clipping uses actual backing sizes and nearby anchors`,async({page})=>{
  test.setTimeout(180000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/mapseekai/emap/examples/luma-benchmark/');
  await page.waitForFunction(()=>window.lumaBenchmark?.state==='idle');
  await page.evaluate(()=>window.lumaBenchmark.dispose());
  await page.addScriptTag({path:bundle});
  for(const {canvasSize,scenario,reach,farFirst,width,scale} of [
    {canvasSize:[95,97],scenario:'tiny',width:.6},
    {canvasSize:[97,95],scenario:'tiny',width:.6},
    {canvasSize:[1295,973],scenario:'tiny',width:.6},
    {canvasSize:[95,97],scenario:'closed',reach:1e-13,width:7},
    {canvasSize:[95,97],scenario:'closed',reach:1e-9,scale:1e-5,width:7},
    {canvasSize:[1295,973],scenario:'precise',reach:1e9,farFirst:false,width:7},
    {canvasSize:[95,97],scenario:'precise',reach:1e9,farFirst:true,width:7},
  ]) {
    const dpr=1.3,backing=canvasSize.map(n=>Math.round(n*dpr));
    const anchor=canvasSize.map((n,i)=>(Math.floor(backing[i]*.75)+.5)*n/backing[i]);
    const result=await page.evaluate(options=>window.verifyReversalPixels(options),{backend,dpr,canvasSize,anchor,scenario,reach,farFirst,width,scale,shift:0});
    expect(result.actualBackend).toBe(backend);expect(result.samples).toBe(4);
    expect(result.errors).toEqual([]);expect(result.liveBufferBytes).toBe(0);
    for(const row of result.rows) {
      expect(row.submitted).toBeGreaterThan(0);
      expect(row.targetAlpha,JSON.stringify({canvasSize,scenario,farFirst,row})).toBeGreaterThan(0);
      expect(row.missing,JSON.stringify({canvasSize,scenario,farFirst,row})).toBe(0);
      expect(row.extra,JSON.stringify({canvasSize,scenario,farFirst,row})).toBe(0);
    }
  }
  expect(errors).toEqual([]);
});
