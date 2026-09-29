// Reproducible full-file benchmark of the formal map, not the experimental renderer.
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve } from 'node:path';
import os from 'node:os';

const exec = promisify(execFile);
const arg = (key, fallback) => { const i = process.argv.indexOf(key); return i < 0 ? fallback : process.argv[i + 1]; };
if (process.argv.includes('--help')) {
  console.log('node scripts/benchmark-renderer-matrix.mjs --files /path/a.geojson,/path/b.gpkg [--renderers canvas2d,webgl2,webgpu] [--frames 90] [--output test-results/renderer-matrix] [--base-url http://127.0.0.1:4186/mapseekai/emap/examples/] [--views full,in-4,out-2,out-1] [--profile-load] [--wait-lod]\nBuild emap and examples, then start the examples production preview first. Uses installed Chrome and original files, local only. Each case gets a fresh isolated browser. Viewport 1280x900, DPR 1. Default sequence: 1,2,4,8,16,8,4,2,1,0.5,0.25,1. Profiled loads are diagnostics, not comparable timings.');
  process.exit(0);
}
const files = arg('--files', '').split(',').filter(Boolean).map((file) => resolve(file));
const renderers = arg('--renderers', 'canvas2d,webgl2,webgpu').split(',');
const frames = Number(arg('--frames', '90'));
const profileLoad = process.argv.includes('--profile-load');
const base = new URL(arg('--base-url', 'http://127.0.0.1:4186/mapseekai/emap/examples/'));
const out = resolve(arg('--output', 'test-results/renderer-matrix'));
if (!files.length || renderers.some((v) => !['canvas2d', 'webgl2', 'webgpu'].includes(v)) || !Number.isInteger(frames) || frames < 10 || frames > 600) throw new Error('Invalid files, renderers, or frames (10..600)');
if (!['http:', 'https:'].includes(base.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || !base.pathname.endsWith('/')) throw new Error('Expected a loopback examples URL ending in /');
await mkdir(out, { recursive: true });
const allViews = [['full', 1], ['in-2', 2], ['in-4', 4], ['in-8', 8], ['in-16', 16], ['out-8', 8], ['out-4', 4], ['out-2', 2], ['out-1', 1], ['far-0.5', 0.5], ['far-0.25', 0.25], ['restore-1', 1]];
const selectedViews = arg('--views', '').split(',').filter(Boolean);
if (selectedViews.some((label) => !allViews.some((view) => view[0] === label))) throw new Error('Unknown view name');
const sequence = selectedViews.length ? selectedViews.map((label) => allViews.find((view) => view[0] === label)) : allViews;
const workerAssets = (await readdir('packages/examples/dist/assets')).filter((name) => /^import-worker-.*\.js$/.test(name));
if (workerAssets.length !== 1) throw new Error('Build examples first; expected one import-worker asset');
const probe = await build({
  entryPoints: ['test/browser/fixtures/performance-matrix.mjs'], bundle: true, write: false, format: 'iife', platform: 'browser',
  define: { 'import.meta.env.BASE_URL': JSON.stringify(base.pathname), 'import.meta.url': JSON.stringify(new URL('emap.js', base).href) },
  alias: { mapshaper: resolve('packages/examples/src/mapshaper-global.ts') },
  // Unused mproj disk-file fallback; actual CRS work uses the built emap runtime.
  external: ['fs', 'path'],
  plugins: [{ name: 'built-example-worker', setup(builder) {
    builder.onResolve({ filter: /\?worker&url$/ }, () => ({ path: 'import-worker', namespace: 'built-worker' }));
    builder.onLoad({ filter: /.*/, namespace: 'built-worker' }, () => ({ contents: `export default ${JSON.stringify(new URL('assets/' + workerAssets[0], base).href)}` }));
  } }],
});
const result = { started: new Date().toISOString(), viewport: { width: 1280, height: 900, dpr: 1 }, frames, profileLoad, sequence, host: { platform: os.platform(), arch: os.arch(), release: os.release(), cpu: os.cpus()[0].model, cores: os.cpus().length, memory: os.totalmem() }, inputs: [], cases: [] };
const checkpoint = () => writeFile(out + '/results.json', JSON.stringify(result, null, 2));
const hash = async (file) => { const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk); return h.digest('hex'); };
for (const file of files) {
  const info = await stat(file);
  if (!info.isFile() || !/\.(geojson|gpkg)$/i.test(file)) throw new Error('Expected a GeoJSON or GeoPackage file');
  const input = { path: file, bytes: info.size, modified: info.mtimeMs, sha256: await hash(file) };
  if (file.endsWith('.gpkg')) {
    const python = `import sqlite3,pathlib,json,sys\np=pathlib.Path(sys.argv[1]);db=sqlite3.connect(p.as_uri()+'?mode=ro&immutable=1',uri=True)\ntables=[]\nfor (name,) in db.execute('SELECT table_name FROM gpkg_geometry_columns ORDER BY table_name').fetchall():\n q='"'+name.replace('"','""')+'"';tables.append({'table':name,'rows':db.execute('SELECT count(*) FROM '+q).fetchone()[0]})\nprint(json.dumps(tables));db.close()`;
    input.tables = JSON.parse((await exec('python3', ['-c', python, file])).stdout);
  }
  result.inputs.push(input);
}
for (const input of result.inputs) for (const renderer of renderers) {
  const name = basename(input.path).replace(/\.[^.]+$/, '') + '-' + renderer;
  const directory = out + '/' + name;
  await mkdir(directory, { recursive: true });
  const item = { name, file: input.path, renderer, frames, errors: [], consoleErrors: [], failedRequests: [], views: [], peakBrowserRss: 0 };
  result.cases.push(item);
  let browser, watchdog, monitoring = false;
  const start = Date.now();
  console.log(JSON.stringify({ case: name, phase: 'start' }));
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-background-networking', '--enable-precise-memory-info'] });
    item.browserVersion = browser.version();
    const root = await browser.newBrowserCDPSession();
    item.gpu = (await root.send('SystemInfo.getInfo')).gpu;
    const pid = (await root.send('SystemInfo.getProcessInfo')).processInfo.find((p) => p.type === 'browser').id;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await context.route('**/*', (route) => { const url = new URL(route.request().url()); return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol) ? route.continue() : route.abort(); });
    const page = await context.newPage();
    page.on('pageerror', (e) => item.errors.push(String(e)));
    page.on('console', (msg) => { if (msg.type() === 'error') item.consoleErrors.push(msg.text()); });
    page.on('requestfailed', (request) => item.failedRequests.push({ url: request.url(), reason: request.failure()?.errorText }));
    page.on('crash', () => { item.crashed = true; });
    page.setDefaultTimeout(120000);
    const cdp = await context.newCDPSession(page);
    watchdog = setInterval(async () => {
      if (monitoring) return;
      monitoring = true;
      try {
        const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,rss=']);
        const processes = stdout.trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number));
        const owned = new Set([pid]);
        for (let i = 0; i < 8; i++) for (const [child, parent] of processes) if (owned.has(parent)) owned.add(child);
        const rss = processes.reduce((sum, [child, , kb]) => sum + (owned.has(child) ? kb * 1024 : 0), 0);
        item.peakBrowserRss = Math.max(item.peakBrowserRss, rss);
        if (rss > 10 * 1024 ** 3 || Date.now() - start > 12 * 60000) {
          item.stopReason = rss > 10 * 1024 ** 3 ? 'Isolated browser RSS exceeded 10 GiB' : 'Case exceeded 12 minutes';
          await browser.close();
        }
      } catch { /* Process may already be closed. */ } finally { monitoring = false; }
    }, 1000);
    await page.goto(new URL('geopackage-viewer/?renderer=' + renderer, base).href);
    await page.waitForFunction(() => window.geopackageDemo?.source && !geopackageDemo.loading);
    await page.addScriptTag({ content: probe.outputFiles[0].text });
    await page.evaluate(() => installMatrixProbe());
    item.actualBackend = await page.evaluate(() => geopackageDemo.map.getRenderer());
    if (item.actualBackend !== renderer) throw new Error('Backend fallback/mismatch');
    item.baseline = await page.evaluate(async () => {
      const t = [];
      for (let i = 0; i < 61; i++) t.push(await new Promise(requestAnimationFrame));
      return { fps: 60000 / (t.at(-1) - t[0]), maxFrameMs: Math.max(...t.slice(1).map((v, i) => v - t[i])), visible: document.visibilityState, device: matrixProbe.map.ctx.render._painter.gpu?.device?.info ?? null };
    });
    if (item.baseline.fps < 45) throw new Error('Invalid throttled baseline: ' + item.baseline.fps);
    await page.evaluate(() => {
      const file = document.createElement('input'); file.id = 'matrix-file'; file.type = 'file'; document.body.append(file);
      file.onchange = () => { void matrixProbe.loadFile(file.files[0]); };
    });
    if (profileLoad) {
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.start');
    }
    await page.locator('#matrix-file').setInputFiles(input.path);
    await page.waitForFunction(() => matrixProbe.ready || matrixProbe.error, undefined, { timeout: 600000, polling: 500 });
    const loaded = await page.evaluate(() => ({ error: matrixProbe.error, load: matrixProbe.load, state: matrixProbe.snapshot(), stats: matrixProbe.phaseStats.load, longTasks: matrixProbe.longTasks.filter((t) => t.phase === 'load') }));
    item.loaded = loaded;
    if (profileLoad) {
      const { profile } = await cdp.send('Profiler.stop');
      await writeFile(directory + '/load.cpuprofile', JSON.stringify(profile));
      await cdp.send('Profiler.disable');
    }
    if (loaded.error) throw new Error(loaded.error);
    if (loaded.state.dimensions.width !== 1280 || loaded.state.dimensions.height !== 900 || loaded.state.dimensions.dpr !== 1) throw new Error('Viewport mismatch');
    if (input.tables) {
      const sort = (tables) => [...tables].sort((a, b) => a.table.localeCompare(b.table));
      if (JSON.stringify(sort(input.tables)) !== JSON.stringify(sort(loaded.state.tables))) throw new Error('Native SQLite and imported table counts differ');
    }
    console.log(JSON.stringify({ case: name, phase: 'loaded', readyMs: loaded.load.readyMs, features: loaded.state.features }));
    await checkpoint();
    // An explicit diagnostic mode waits for background display LOD too. Keep it
    // separate from initial-visible-frame measurements and record the extra wait.
    if (process.argv.includes('--wait-lod')) {
      item.displayLodWaitMs = await page.evaluate(async () => {
        const start = performance.now();
        await geopackageDemo.source.getDisplayArcs()?.ready;
        geopackageDemo.map.render();
        await matrixProbe.settle();
        return performance.now() - start;
      });
    }
    for (const [label, zoom] of sequence) {
      let view;
      try {
        view = await page.evaluate((args) => matrixProbe.sample(args), { frames, zoom, label });
        view.pixels = await page.evaluate(() => matrixProbe.pixels());
        view.cdpHeap = await cdp.send('Runtime.getHeapUsage');
        await page.screenshot({ path: directory + '/' + label + '.png' });
      } catch (error) {
        view = { label, zoom, failure: String(error) };
        view.diagnostic = await page.evaluate(() => ({ state: matrixProbe.snapshot(), residency: matrixProbe.residency() }));
        await page.screenshot({ path: directory + '/' + label + '-failed.png' });
        await page.evaluate(() => matrixProbe.map.stop());
      }
      item.views.push(view);
      await checkpoint();
      console.log(JSON.stringify({ case: name, view: label, redrawFps: view.redraw?.fps, cpuP95: view.redraw?.cpuMs.p95, navigationFps: view.navigation?.fps, transitionMs: view.transitionMs, pixels: view.pixels?.nonTransparent, failure: view.failure }));
    }
    item.disposal = await page.evaluate(async () => { const p = matrixProbe.map.ctx.render._painter; await matrixProbe.map.dispose(); return p.stats ?? null; });
    item.status = item.errors.length || item.consoleErrors.length || item.views.some((view) => view.failure) ? 'completed-with-errors' : 'passed';
  } catch (error) {
    item.status = 'failed';
    item.failure = String(error);
    console.log(JSON.stringify({ case: name, phase: 'failed', failure: item.failure, stopReason: item.stopReason }));
  } finally {
    clearInterval(watchdog);
    await browser?.close().catch(() => {});
    item.elapsedMs = Date.now() - start;
    await checkpoint();
  }
}
for (const input of result.inputs) input.unchanged = (await stat(input.path)).mtimeMs === input.modified && (await hash(input.path)) === input.sha256;
result.completed = new Date().toISOString();
await checkpoint();
console.log('RESULTS ' + out + '/results.json');
if (result.cases.some((item) => item.status !== 'passed') || result.inputs.some((input) => !input.unchanged)) process.exitCode = 1;
