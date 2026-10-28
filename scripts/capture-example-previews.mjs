#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { readExamples } from './docs-check-utils.mjs';

const { values } = parseArgs({ options: {
  'base-url': { type: 'string', default: 'http://127.0.0.1:4187' },
  'output-dir': { type: 'string', default: 'packages/examples/public/previews' },
  'executable-path': { type: 'string' },
  only: { type: 'string', multiple: true },
  missing: { type: 'boolean', default: false },
  software: { type: 'boolean', default: false },
} });
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, values['output-dir']);
const fixtures = resolve(root, 'packages/examples/public/fixtures');
const examples = (await readExamples(root)).filter(example => !values.only?.length || values.only.some(id => example.id === id || example.id.startsWith(id + '/')));
if (!examples.length) throw new Error('No matching examples. Use --only with an example id or category path.');
await mkdir(output, { recursive: true });
const reportPath = resolve(output, 'captures.json');
let captures = {};
try { captures = JSON.parse(await readFile(reportPath, 'utf8')).captures; } catch (error) { if (error.code !== 'ENOENT') throw error; }

const browser = await chromium.launch({
  executablePath: values['executable-path'],
  args: values.software ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 604 }, deviceScaleFactor: 1, locale: 'zh-CN', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  // Preserve real WebGL frames for a content check before saving a capture.
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, options) {
    return getContext.call(this, type, type === 'webgl2' ? { ...options, preserveDrawingBuffer: true } : options);
  };
  window.__emapPreviewPixels = () => {
    const canvas = document.querySelector('#map canvas[data-emap-renderer="webgl2"], #webgl, .numeric-raster');
    if (!canvas?.width || !canvas.height) return null;
    const gl = canvas.getContext('webgl2');
    if (!gl || gl.isContextLost()) return null;
    const { width, height } = canvas;
    const pixels = new Uint8Array(width * height * 4);
    const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous);
    let painted = 0, ink = 0;
    const colors = new Set();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 16) painted++;
      if (pixels[i + 3] > 200 && pixels[i] < 70 && pixels[i + 1] < 90 && pixels[i + 2] < 120) ink++;
      if (colors.size < 256) colors.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
    }
    let hit;
    for (let y = Math.floor(height / 2); y < height * .8 && !hit; y += 3) {
      let start = -1;
      for (let x = 0; x <= width; x++) {
        const offset = (y * width + x) * 4;
        const filled = x < width && pixels[offset + 3] > 40 && pixels[offset] + pixels[offset + 1] + pixels[offset + 2] < 730;
        if (filled && start < 0) start = x;
        if (!filled && start >= 0) {
          if (x - start > 16) { hit = { x: (start + x) / 2, y: height - y - 1 }; break; }
          start = -1;
        }
      }
    }
    return { width, height, painted, colors: colors.size, hit, ink };
  };
});

const actions = {
  'getting-started/points': '#btn', 'getting-started/polygons': '#btn',
  explode: '#btn', innerlines: '#btn', dissolve: '#dissolve-btn',
  union: '#union-btn', divide: '#btn', mosaic: '#btn', clip: '#run', erase: '#run',
  'check-geometry': '#check-btn', 'rebuild-topology': '#rebuild-btn',
  'filter-features': '#btn', 'attribute-expressions': '#apply-btn',
};
const selectable = new Set(['feature-attributes', 'feature-selection', 'attribute-editing', 'vertex-editing', 'feature-translate', 'feature-rotate', 'feature-scale', 'merge-selected']);
async function deadline(promise, timeout, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), timeout); })]);
  } finally { clearTimeout(timer); }
}
async function closeOperations(page) {
  const close = page.getByRole('button', { name: '收起操作', exact: true });
  if (await close.isVisible()) await close.click();
}
async function painted(page) {
  await page.waitForFunction(() => {
    const pixels = window.__emapPreviewPixels();
    return pixels && pixels.painted > 8 && pixels.colors > 1;
  }, null, { timeout: 45000 });
}
async function runAction(page, selector) {
  const control = page.locator(selector);
  await control.waitFor();
  await page.waitForFunction(selector => !document.querySelector(selector)?.disabled, selector);
  const status = await page.locator('#status').textContent();
  await control.click();
  await page.waitForFunction(({ selector, status }) => {
    const current = document.querySelector('#status');
    return current?.textContent !== status && !/正在|初始化|加载中|检查金字塔/.test(current?.textContent ?? '');
  }, { selector, status }, { timeout: 150000 });
  const error = await page.locator('#status').evaluate(node => node.dataset.state === 'error' || /失败|出错|错误/.test(node.textContent));
  if (error) throw new Error(await page.locator('#status').textContent());
}
async function prepare(page, example) {
  const id = example.id;
  if (id === 'plugin-install') {
    await page.waitForFunction(() => document.querySelectorAll('.runtime-row').length > 0 && document.querySelector('#runtime-proof')?.textContent.includes('Context.is(map.ctx) = true'));
    return;
  }
  if (['getting-started/polygons', 'innerlines'].includes(id)) {
    const data = JSON.parse(await readFile(resolve(fixtures, 'task-7-polygons.geojson'), 'utf8'));
    if (id === 'getting-started/polygons') {
      for (const feature of data.features) feature.geometry = { type: 'MultiLineString', coordinates: feature.geometry.coordinates };
    } else {
      const ring = data.features[0].geometry.coordinates[0];
      const minX = Math.min(...ring.map(p => p[0])), maxX = Math.max(...ring.map(p => p[0]));
      const minY = Math.min(...ring.map(p => p[1])), maxY = Math.max(...ring.map(p => p[1]));
      const middle = (minX + maxX) / 2;
      data.features = [[minX, middle], [middle, maxX]].map(([left, right], index) => ({
        type: 'Feature', properties: { name: `Adjacent ${index + 1}` }, geometry: { type: 'Polygon', coordinates: [[[left,minY],[right,minY],[right,maxY],[left,maxY],[left,minY]]] },
      }));
    }
    await painted(page);
    await page.locator('#file-input').setInputFiles({ name: `${id.replaceAll('/', '-')}-preview.geojson`, mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.waitForFunction(() => {
      const status = document.querySelector('#status')?.textContent ?? '';
      return status.includes('-preview.geojson') && !status.startsWith('正在');
    });
  }
  if (id === 'filter-features') await page.locator('#expr').fill('pop > 100');
  if (id === 'labels') {
    await page.waitForFunction(() => document.querySelector('#status')?.dataset.state === 'ready');
    await page.locator('#label-font-url').fill(new URL('/mapseekai/emap/examples/msdf/fonts/noto-sans-sc-latin-400-normal.woff', values['base-url']).href);
    await page.locator('#label-font-url').press('Tab');
  }
  if (['duckdb-buffer', 'duckdb/geometry/simplify', 'duckdb/geometry/simplify-preserve-topology'].includes(id)) {
    await page.locator('#allow-geographic').check();
    await page.locator(id === 'duckdb-buffer' ? '#distance' : '#tolerance').fill(id === 'duckdb-buffer' ? '0.004' : '0.002');
  }
  if (id === 'duckdb/attribute/measures') {
    await painted(page);
    await page.locator('.emap-example-crs-select').selectOption('EPSG:3857');
    await page.waitForFunction(() => !document.querySelector('.emap-example-crs-select').disabled);
  }
  if (id === 'union') {
    await page.waitForFunction(() => document.querySelectorAll('input[data-layer-name]').length >= 2);
    for (const input of await page.locator('input[data-layer-name]').all()) if (!(await input.isChecked())) await input.locator('..').click();
  }
  if (id === 'create-layer') {
    await page.waitForSelector('#fields .field-row');
    await page.locator('#geometry').selectOption('polygon');
    await page.locator('#create').click();
    await page.waitForFunction(() => !document.querySelector('#stop').disabled);
    await closeOperations(page);
    const map = await page.locator('#map').boundingBox();
    for (const [x, y] of [[.24, .65], [.35, .23], [.55, .35], [.73, .60]]) await page.mouse.click(map.x + map.width * x, map.y + map.height * y);
    await page.mouse.dblclick(map.x + map.width * .6, map.y + map.height * .8);
    await page.getByRole('button', { name: '展开操作', exact: true }).click();
    await page.locator('#stop').click();
  } else if (id === 'mixed-data-viewer') {
    await page.waitForFunction(() => Boolean(document.querySelector('#vector-input')?.onchange));
    await page.locator('#vector-input').setInputFiles(resolve(fixtures, 'task-6-polygons.geojson'));
    await page.waitForFunction(() => document.querySelector('#status')?.textContent.startsWith('已加载矢量'));
    await page.locator('#fit-all').click();
  } else if (['luma-benchmark', 'luma-vertex-editing', 'luma-raster'].includes(id)) {
    await page.waitForFunction(id => Boolean(id === 'luma-raster' ? window.lumaRaster : id === 'luma-benchmark' ? window.lumaBenchmark : window.lumaEditor), id);
    await page.locator('#file-input').setInputFiles(resolve(fixtures, id === 'luma-raster' ? 'example-geotiff-uint16.tif' : 'task-7-polygons.geojson'));
    await page.locator(id === 'luma-benchmark' ? '#load-file' : '#load').click();
    await page.waitForFunction(id => (id === 'luma-raster' ? window.lumaRaster : id === 'luma-benchmark' ? window.lumaBenchmark : window.lumaEditor)?.state === 'ready', id);
    if (id === 'luma-vertex-editing') await page.locator('#select-id').click();
  }
  if (id !== 'duckdb-geoparquet-query') await painted(page);
  if (id === 'duckdb-geoparquet-query') await painted(page);
  else if (id.startsWith('duckdb')) await runAction(page, '#run');
  else if (actions[id]) await runAction(page, actions[id]);
  await closeOperations(page);
  // Refitting after the shell has resized keeps all geometry inside the preview.
  const home = page.locator('#map .emap-ctrl-home');
  if (id !== 'duckdb/join/attribute-join' && await home.isVisible()) await home.click();
  if (id === 'labels') await page.locator('.emap-ctrl-zoom-out').click();
  if (selectable.has(id)) {
    const pixels = await page.evaluate(() => window.__emapPreviewPixels());
    if (pixels.hit) {
      const map = await page.locator('#map').boundingBox();
      await page.mouse.click(map.x + pixels.hit.x, map.y + pixels.hit.y);
    }
  }
  await painted(page);
  if (id === 'labels') await page.waitForFunction(() => window.__emapPreviewPixels()?.ink > 20, null, { timeout: 45000 });
  await page.mouse.move(0, 0);
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const failures = [];
try {
  for (const [index, example] of examples.entries()) {
    const file = resolve(output, `${example.id}.jpg`);
    if (values.missing && captures[example.id]) {
      try { await access(file); console.log(`[${index + 1}/${examples.length}] ${example.id}: already captured`); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const page = await context.newPage();
    page.setDefaultTimeout(45000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      console.log(`[${index + 1}/${examples.length}] ${example.id}: loading`);
      const url = new URL(`/mapseekai/emap/examples/${example.id}/?renderer=webgl2`, values['base-url']);
      await page.goto(url.href, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('body.example-detail');
      await deadline(prepare(page, example), 180000, 'Example preparation exceeded three minutes');
      if (errors.length) throw new Error(errors.join('; '));
      const pixels = await page.evaluate(() => window.__emapPreviewPixels());
      const target = page.locator(example.id === 'plugin-install' ? '.example-application' : '.example-demo-area');
      const bounds = await target.boundingBox();
      const buffer = await target.screenshot({ type: 'jpeg', quality: 85, animations: 'disabled' });
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, buffer);
      captures[example.id] = {
        file: `${example.id}.jpg`, route: new URL(page.url()).pathname,
        renderer: 'webgl2', width: bounds.width, height: bounds.height,
        kind: example.id === 'plugin-install' ? 'runtime-inspector' : 'map',
        painted: pixels.painted, colors: pixels.colors,
        sha256: createHash('sha256').update(buffer).digest('hex'),
      };
      await writeFile(reportPath, JSON.stringify({ viewport: { width: 1280, height: 604 }, captures: Object.fromEntries(Object.entries(captures).sort(([a], [b]) => a.localeCompare(b))) }, null, 2) + '\n');
      console.log(`[${index + 1}/${examples.length}] ${example.id}: captured ${bounds.width}×${bounds.height}`);
    } catch (error) {
      failures.push(example.id);
      console.error(`[${index + 1}/${examples.length}] ${example.id}: ${error.message}`);
      console.error(JSON.stringify(await deadline(page.evaluate(() => ({
        status: document.querySelector('#status')?.textContent,
        pixels: window.__emapPreviewPixels?.(),
        inputs: Array.from(document.querySelectorAll('input[type="file"]'), input => ({ id: input.id, files: input.files.length, changeHandler: Boolean(input.onchange) })),
      })), 5000, 'Page diagnostics timed out').catch(() => ({}))));
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
if (failures.length) { console.error(`Missing captures: ${failures.join(', ')}`); process.exitCode = 1; }
