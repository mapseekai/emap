import { test, expect } from '@playwright/test';
import { examples } from '../../docs-meta/examples.ts';
const base = '/mapseekai/emap/examples/';
const gpuOnly = ['luma-25d','luma-vertex-editing'];
const button = (page, renderer) => page.locator(`[data-example-renderer="${renderer}"]`);
async function actual(page, renderer) {
  await expect(button(page, renderer)).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#map canvas[data-emap-renderer]').first()).toHaveAttribute('data-emap-renderer',renderer);
}
async function loadNativeVectorFixture(page, id) {
  if (['luma-raster', 'luma-benchmark', 'luma-vertex-editing'].includes(id) &&
      !(await page.locator('.example-parameters').isVisible()))
    await page.getByRole('button', { name: '展开操作', exact: true }).click();
  if (id === 'luma-raster') {
    await page.waitForFunction(() => Boolean(window.lumaRaster));
    await page.locator('#file-input').setInputFiles('packages/examples/public/fixtures/example-geotiff-uint16.tif');
    await page.locator('#load').click();
    await expect.poll(() => page.evaluate(() => window.lumaRaster?.state)).toBe('ready');
    return;
  }
  if (!['luma-benchmark', 'luma-vertex-editing'].includes(id)) return;
  const benchmark = id === 'luma-benchmark';
  await page.waitForFunction(benchmark => Boolean(benchmark ? window.lumaBenchmark : window.lumaEditor), benchmark);
  await page.locator('#file-input').setInputFiles('packages/examples/public/fixtures/getting-started-points.geojson');
  await page.locator(benchmark ? '#load-file' : '#load').click();
  await expect.poll(() => page.evaluate(benchmark => (benchmark ? window.lumaBenchmark : window.lumaEditor)?.state, benchmark)).toBe('ready');
}
// Every route is visited, including generated DuckDB workflows and the standalone GPU experiments.
for (const example of examples) {
  test(`${example.id}: shared renderer controls and default backend`, async ({page}) => {
  await page.goto(base+example.id+'/');
  await expect(page.locator('.emap-example-renderer-tools')).toHaveCount(1);
  await expect(page.locator('[data-example-renderer]')).toHaveCount(3);
  await expect(button(page,'webgl2')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('body')).toHaveClass(/example-detail/);
  const viewport = page.viewportSize();
  const surface = await page.locator(example.id === 'luma-benchmark' ? '#stage' : '#map').boundingBox();
  expect(surface.y + surface.height).toBeLessThanOrEqual(viewport.height);
  expect(surface.height).toBeGreaterThan(viewport.height * 0.6);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
  if (gpuOnly.includes(example.id)) await expect(button(page,'canvas2d')).toBeDisabled();
  else await expect(button(page,'canvas2d')).toBeEnabled();
  if (!example.id.startsWith('luma-')) await actual(page,'webgl2');
  else {
    await loadNativeVectorFixture(page, example.id);
    const canvas = page.locator(example.id === 'luma-raster' ? '.numeric-raster' : '#webgl');
    await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.evaluate(node => Boolean(node.getContext('webgl2')))).toBe(true);
  }
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

test.describe('consistent rendering: device pixel ratio', () => {
  test.use({ deviceScaleFactor: 3, viewport: { width: 1000, height: 800 } });
  for (const id of ['getting-started/lines', 'luma-benchmark', 'luma-vertex-editing', 'luma-25d', 'luma-raster'])
    test(`${id} uses the device ratio for its actual render canvas`, async ({ page }) => {
      await page.goto(base + id + '/');
      await loadNativeVectorFixture(page, id);
      const selector = id === 'luma-raster' ? '.numeric-raster' : id.startsWith('luma-') ? '#webgl' : '#map canvas[data-emap-renderer]';
      const canvas = page.locator(selector).first();
      await expect(canvas).toBeVisible();
      await expect.poll(() => canvas.evaluate(node => node.width / node.getBoundingClientRect().width)).toBeCloseTo(3, 1);
      await expect.poll(() => canvas.evaluate(node => node.height / node.getBoundingClientRect().height)).toBeCloseTo(3, 1);
    });
});

for (const id of ['luma-benchmark', 'luma-vertex-editing', 'luma-25d'])
  test(`consistent rendering: ${id} honors pointLod=off in controls and renderer`, async ({ page }) => {
    await page.goto(base + id + '/?parameters=open&pointLod=off&nav=off');
    await expect.poll(() => page.evaluate(id => {
      if (id === 'luma-25d') return window.luma25d?.snapshot.pointLod.enabled;
      return (id === 'luma-benchmark' ? window.lumaBenchmark : window.lumaEditor)?.pointLodStats.enabled;
    }, id)).toBe(false);
    await expect(page.locator('#point-lod-enabled')).not.toBeChecked();
    await expect(page.locator('#fast-nav')).not.toBeChecked();
    await expect.poll(() => page.evaluate(id => {
      if (id === 'luma-25d') return window.luma25d?.snapshot.navigation.enabled;
      return (id === 'luma-benchmark' ? window.lumaBenchmark : window.lumaEditor)?.navigationStats.enabled;
    }, id)).toBe(false);
  });

test('consistent rendering: renderer selection survives example and catalog navigation', async ({ page }) => {
  await page.goto(base + 'getting-started/lines/?renderer=canvas2d');
  await page.locator('.example-navigation a').filter({ hasText: '点图层样式' }).click();
  await actual(page, 'canvas2d');
  await page.locator('.example-back-link').click();
  await expect(page).toHaveURL(/renderer=canvas2d/);
  await page.locator('a.example-card[href*="getting-started/polygon-fill/"]').click();
  await actual(page, 'canvas2d');
});

test('consistent rendering: GPU-only destinations open with a supported renderer', async ({ page }) => {
  await page.goto(base + '?renderer=canvas2d');
  await page.locator('a.example-card[href*="luma-25d/"]').click();
  await expect(button(page, 'canvas2d')).toBeDisabled();
  await expect(button(page, 'webgl2')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.luma25d?.snapshot.backend)).toBe('webgl');
});
for (const id of ['geotiff-viewer', 'luma-raster', 'luma-25d'])
  test(`consistent rendering: ${id} defaults to nearest raster sampling`, async ({ page }) => {
    await page.goto(base + id + '/?parameters=open');
    if (id === 'luma-25d') await expect(page.locator('#bilinear')).not.toBeChecked();
    else await expect(page.locator('#resampling')).toHaveValue('nearest');
  });
test('consistent rendering: native raster live changes survive reload', async ({ page }) => {
  await page.goto(base + 'luma-raster/?parameters=open');
  await loadNativeVectorFixture(page, 'luma-raster');
  await page.locator('#backend').selectOption('canvas');
  await expect(page).toHaveURL(/renderer=canvas2d/);
  await expect.poll(() => page.evaluate(() => window.lumaRaster?.stats().backend)).toBe('canvas');
  await expect.poll(() => page.evaluate(() => window.lumaRaster?.state)).toBe('ready');
  await page.reload();
  await expect(page.locator('#backend')).toHaveValue('canvas');
  await expect(button(page, 'canvas2d')).toHaveAttribute('aria-pressed', 'true');
  await loadNativeVectorFixture(page, 'luma-raster');
  await expect.poll(() => page.evaluate(() => window.lumaRaster?.stats().backend)).toBe('canvas');
});
test('consistent rendering: native raster uses the selected WebGPU adapter and paints data', async ({ page }) => {
  await page.goto(base + 'luma-raster/?parameters=open&renderer=webgpu');
  await loadNativeVectorFixture(page, 'luma-raster');
  await expect(button(page, 'webgpu')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#backend')).toHaveValue('webgpu');
  const painted = await page.evaluate(async () => {
    const image = await window.lumaRaster.capture();
    let count = 0;
    for (let index = 3; index < image.pixels.length; index += 4)
      if (image.pixels[index]) count++;
    return count;
  });
  expect(painted).toBeGreaterThan(0);
});
test('legacy experiment links and canonical renderer buttons agree', async ({page}) => {
  await page.goto(base+'luma-benchmark/?parameters=open&gpu=webgpu&renderer=canvas&nav=off');
  await expect(button(page,'canvas2d')).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('#backend')).toHaveValue('canvas');
  await expect(page.locator('#gpu-backend')).toHaveValue('webgpu');
  await button(page,'webgl2').click();
  await expect(page.locator('#gpu-backend')).toHaveValue('webgl');
  await expect(page.locator('#backend')).toHaveValue('luma');
  await page.locator('#backend').selectOption('canvas');
  await expect(button(page,'canvas2d')).toHaveAttribute('aria-pressed','true');
  await expect(page).toHaveURL(/renderer=canvas2d/);
  await page.reload();
  await expect(page.locator('#backend')).toHaveValue('canvas');
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
