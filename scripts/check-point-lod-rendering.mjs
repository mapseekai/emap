// Native Canvas verification for the point LOD rendering pipeline.
// Run: node scripts/check-point-lod-rendering.mjs (requires installed Chrome).
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  stdin: { contents: [
    "export { CanvasPainter } from './src/renderer/canvas-painter';",
    "export { Viewport } from './src/geo/viewport';",
    "export { renderLayers } from './src/map/layer-renderer';",
    "export { FilterResolver } from './src/map/filter-resolver';",
    "export { StyleResolver } from './src/map/style-resolver';",
  ].join('\n'), resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'browser', format: 'iife', globalName: 'PointLodTest',
  write: false, logLevel: 'silent',
});
const server = createServer((request, response) => {
  const engine = request.url === '/engine.js';
  response.writeHead(200, { 'content-type': engine ? 'text/javascript' : 'text/html' });
  response.end(engine ? bundle.outputFiles[0].contents : '<!doctype html><script src="/engine.js"></script>');
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome' });
  const scenarios = [
    { width: 1920, height: 1080, dpr: 1, count: 1_000_000 },
    { width: 3840, height: 2160, dpr: 1, count: 1_000_000 },
    { width: 1920, height: 1080, dpr: 1, count: 100_000 },
    { width: 1920, height: 1080, dpr: 2, count: 100_000 },
  ];
  let reference;
  for (const scenario of scenarios) {
    const page = await browser.newPage({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.dpr });
    try {
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const result = await page.evaluate(({ width, height, dpr, count }) => {
        const { CanvasPainter, Viewport, renderLayers, FilterResolver, StyleResolver } = PointLodTest;
        const canvas = document.createElement('canvas');
        document.body.append(canvas);
        const painter = new CanvasPainter(canvas);
        painter.setPixelRatio(dpr);
        painter.resize(width, height);
        const viewport = new Viewport();
        viewport.updateSize(width, height);
        const checks = [];
        const check = (name, passed) => checks.push({ name, passed: Boolean(passed) });
        let submitted = 0, paintedIds = [], paintedParts = [];
        const draw = painter.drawPoints.bind(painter);
        painter.drawPoints = (shapes, style, ids, parts) => {
          submitted += ids?.length ?? shapes.reduce((n, shape) => n + (shape?.length ?? 0), 0);
          if (ids) for (const id of ids) paintedIds.push(id);
          if (parts) for (const part of parts) paintedParts.push(part);
          draw(shapes, style, ids, parts);
        };
        let seed = 12345;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        let layer = { geometry_type: 'point', shapes: Array.from({ length: count }, () => [[random() * width / 2, random() * height / 2]]) };
        let dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
        let spec = { id: 'dots', source: 's', type: 'circle', paint: { 'circle-color': '#123456', 'circle-radius': 4 } };
        const source = { type: 'topology', getDataset: () => dataset, getLayers: () => [layer], getArcs: () => undefined, getDisplayArcs: () => null };
        const context = { layers: [spec], sources: new Map([['s', source]]), viewport, painter,
          filterResolver: new FilterResolver(), styleResolver: new StyleResolver(),
          resolveSourceLayer: () => layer, getLayerArcIds: () => null, getRenderCandidates: () => null };
        const paint = (scale, pan = 0) => {
          viewport.applyCameraState([width / (2 * scale) + pan / scale, height / (2 * scale)], scale);
          painter.setTransform(viewport.transform);
          painter.clear(); submitted = 0; paintedIds = []; paintedParts = [];
          context.layers = [spec];
          const start = performance.now();
          renderLayers(context, 1 / scale, 1);
          return { submitted, ms: performance.now() - start };
        };
        const first = paint(2), adjacent = paint(2.001);
        check('dense full extent is thinned', first.submitted > 0 && first.submitted < count * 0.9);
        check('adjacent scale keeps thinning', adjacent.submitted > 0 && adjacent.submitted < count * 0.9);
        check('original feature count preserved', layer.shapes.length === count);
        const visible = new Set(paintedIds);
        let hidden = 0;
        while (hidden < count && visible.has(hidden)) hidden++;
        let reads = 0;
        if (hidden < count) {
          const point = layer.shapes[hidden][0], x = point[0];
          Object.defineProperty(point, '0', { get() { reads++; return x; }, configurable: true });
        }
        const warm = [];
        for (let i = 0; i < 4; i++) warm.push(paint(2.001, i * 2));
        check('warm pan does not revisit a hidden original point', hidden < count && reads === 0);
        if (count === 100_000) {
          spec = { ...spec, pointLod: false };
          const off = paint(2);
          check('explicit opt-out submits original points', off.submitted === count);
        }
        layer = { geometry_type: 'point', shapes: [Array.from({ length: 10_000 }, (_, i) => [50 + i * 1e-9, 50])] };
        dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
        spec = { id: 'dots', source: 's', type: 'circle', paint: { 'circle-color': '#123456', 'circle-radius': 4 } };
        const multipoint = paint(1);
        check('MultiPoint is thinned at coordinate level', multipoint.submitted > 0 && multipoint.submitted < 10);
        check('MultiPoint keeps original feature and component IDs', paintedIds.every((id) => id === 0) && paintedParts.length === multipoint.submitted);
        const pixel = canvas.getContext('2d').getImageData(50 * dpr, (height - 50) * dpr, 1, 1).data;
        check('native Canvas retains the point color at DPR ' + dpr, pixel[0] === 18 && pixel[1] === 52 && pixel[2] === 86 && pixel[3] === 255);
        const records = Array.from({ length: 20_000 }, (_, i) => ({ visible: i % 2 }));
        layer = { geometry_type: 'point', shapes: records.map(() => [[50, 50]]), data: { getRecords: () => records } };
        dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
        paint(1);
        check('deterministic first original representative', paintedIds.length === 1 && paintedIds[0] === 0);
        spec = { ...spec, filter: ['>', ['get', 'visible'], 0] };
        paint(1);
        check('filter reveals another representative', paintedIds.length === 1 && paintedIds[0] === 1);
        const styledRecords = Array.from({ length: 20_000 }, (_, i) => ({ v: i % 2 }));
        layer = { geometry_type: 'point', shapes: styledRecords.map((_, i) => [[50 + (i % 100) * 2, 50 + Math.floor(i / 100) * 0.1]]), data: { getRecords: () => styledRecords } };
        dataset = { layers: [layer], editVersion: 0, attributeVersion: 0 };
        spec = { ...spec, filter: undefined, paint: { 'circle-color': ['match', ['get', 'v'], 0, '#ff0000', '#0000ff'], 'circle-radius': 4 } };
        let stylesCorrect = true;
        const capture = painter.drawPoints;
        painter.drawPoints = (shapes, style, ids, parts) => {
          for (const id of ids ?? []) if (style.color !== (styledRecords[id].v === 0 ? '#ff0000' : '#0000ff')) stylesCorrect = false;
          capture(shapes, style, ids, parts);
        };
        const styled = paint(1);
        check('style buckets preserve original feature attributes', stylesCorrect && styled.submitted > 0 && styled.submitted < 20_000);
        return { checks, first, adjacent, warm, multipoint, styled };
      }, scenario);
      if (scenario.count === 100_000 && scenario.dpr === 1) reference = result;
      if (scenario.dpr === 2) result.checks.push({ name: 'same CSS view chooses identical counts at DPR 1 and 2', passed: result.first.submitted === reference?.first.submitted && result.adjacent.submitted === reference?.adjacent.submitted });
      console.log(JSON.stringify({ browser: browser.version(), ...scenario, ...result }, null, 2));
      if (result.checks.some((check) => !check.passed)) process.exitCode = 1;
    } finally { await page.close(); }
  }
} finally {
  await browser?.close();
  await new Promise((accept) => server.close(accept));
}
