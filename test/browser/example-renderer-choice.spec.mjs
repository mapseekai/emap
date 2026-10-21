import { test, expect } from '@playwright/test';
import { examples } from '../../docs-meta/examples.ts';
const base = '/mapseekai/emap/examples/';
const gpuOnly = ['luma-25d','luma-vertex-editing'];
const button = (page, renderer) => page.locator(`[data-example-renderer="${renderer}"]`);
async function actual(page, renderer) {
  await expect(button(page, renderer)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#map canvas[data-emap-renderer]').first()).toHaveAttribute('data-emap-renderer',renderer);
}
// Every route is visited, including generated DuckDB workflows and the standalone GPU experiments.
for (const example of examples) {
  if (example.id === 'plugin-install' || example.id === 'plugin-capability') continue;
  test(`${example.id}: shared renderer controls and default backend`, async ({page}) => {
  await page.goto(base+example.id+'/');
  await expect(page.locator('.emap-example-renderer-tools')).toHaveCount(1);
  await expect(page.locator('[data-example-renderer]')).toHaveCount(3);
  await expect(button(page,'webgl2')).toHaveAttribute('aria-pressed','true');
  if (gpuOnly.includes(example.id)) await expect(button(page,'canvas2d')).toBeDisabled();
  else await expect(button(page,'canvas2d')).toBeEnabled();
  if (!example.id.startsWith('luma-')) await actual(page,'webgl2');
  });
}
for (const id of ['getting-started/points','getting-started/lines','getting-started/polygon-fill','vertex-editing','geotiff-viewer','mixed-data-viewer','duckdb/geometry/centroid','plugin-install'])
  for (const target of ['canvas2d','webgpu']) test(`${id}: ${target} buttons recreate the map with the selected backend`, async ({page}) => {
    await page.goto(base+id+'/?renderer=webgl2&testParam=keep#sample');
    await actual(page,'webgl2');
    for (const renderer of [target,'webgl2']) {
      await button(page,renderer).focus(); await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp('renderer='+renderer)); await actual(page,renderer);
      expect(new URL(page.url()).hash).toBe('#sample'); expect(new URL(page.url()).searchParams.get('testParam')).toBe('keep');
    }
    await page.evaluate(()=>{window.sameMap=true;});
    await button(page,'webgl2').click(); expect(await page.evaluate(()=>window.sameMap)).toBe(true);
    expect(await page.locator('.emap-example-map-tools').count()).toBe(1);
  });
test('initialization failure still offers working Canvas2D recovery', async ({page}) => {
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){return type==='webgl2'?null:original.call(this,type,...args);};
  });
  await page.goto(base+'getting-started/points/');
  await expect(button(page,'canvas2d')).toBeVisible();
  await button(page,'canvas2d').click(); await actual(page,'canvas2d');
});
test('legacy experiment links and canonical renderer buttons agree', async ({page}) => {
  await page.goto(base+'luma-benchmark/?gpu=webgpu&renderer=canvas&nav=off');
  await expect(button(page,'canvas2d')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#backend')).toHaveValue('canvas');
  await expect(page.locator('#gpu-backend')).toHaveValue('webgpu');
  await button(page,'webgl2').click();
  await expect(page.locator('#gpu-backend')).toHaveValue('webgl');
  await expect(page.locator('#backend')).toHaveValue('luma');
  await page.locator('#backend').selectOption('canvas');
  await expect(button(page,'canvas2d')).toHaveAttribute('aria-pressed','true');
  await page.goto(base+'luma-25d/?renderer=webgpu&gpu=webgl');
  await expect(page.locator('#backend')).toHaveValue('webgpu');
  await expect(button(page,'canvas2d')).toBeDisabled();
});
for (const id of ['getting-started/point-style','luma-25d']) test(`${id}: mobile toolbar is visible and does not overlap`, async ({page},info) => {
  await page.setViewportSize({width:390,height:844}); await page.goto(base+id+'/');
  await expect(button(page,'webgpu')).toBeVisible();
  const bounds = await page.locator('[data-example-renderer]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}));
  for (const box of bounds){expect(box.left).toBeGreaterThanOrEqual(0);expect(box.right).toBeLessThanOrEqual(390);}
  for (let i=1;i<bounds.length;i++)expect(bounds[i].left).toBeGreaterThanOrEqual(bounds[i-1].right);
  await page.screenshot({path:info.outputPath('renderer-mobile.png')});
});
