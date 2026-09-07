// Run after pnpm run build. Tests the actual built CanvasPainter with native pixels.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
await readFile(resolve(dist, 'emap.mjs'));
const names = process.argv.includes('--all-browsers')
  ? ['chrome', 'firefox', 'webkit']
  : (process.env.EMAP_AUDIT_BROWSERS ?? 'chrome').split(',').map((s) => s.trim());
const engines = { chrome: chromium, chromium, firefox, webkit };
for (const name of names) if (!Object.hasOwn(engines, name)) throw new Error(`Unknown browser: ${name}`);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><body></body></html>');
      return;
    }
    if (!pathname.startsWith('/dist/')) { res.writeHead(404); res.end(); return; }
    const file = resolve(dist, decodeURIComponent(pathname.slice('/dist/'.length)));
    const rel = relative(dist, file);
    if (rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(403); res.end(); return; }
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    res.end(content);
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const address = server.address();
try {
  for (const name of names) {
    const browser = await engines[name].launch(name === 'chrome' ? { channel: 'chrome' } : {});
    try {
      const page = await browser.newPage({ deviceScaleFactor: 1 });
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const checks = await page.evaluate(async () => {
        const { CanvasPainter } = await import('/dist/emap.mjs');
        const rings = [
          [[10, 10], [70, 10], [70, 70], [10, 70], [10, 10]],
          [[40, 40], [100, 40], [100, 100], [40, 100], [40, 40]],
          [[25, 25], [35, 25], [35, 35], [25, 35], [25, 25]],
        ];
        function coordinates(part) {
          return part.flatMap((id) => id < 0 ? [...rings[~id]].reverse() : rings[id]);
        }
        const arcs = {
          size: () => rings.length,
          getVertexData: () => ({ nn: new Uint32Array(rings.map((r) => r.length)) }),
          getSimpleShapeBbox(part, out) {
            const points = coordinates(part);
            out[0] = Math.min(...points.map((p) => p[0])); out[1] = Math.min(...points.map((p) => p[1]));
            out[2] = Math.max(...points.map((p) => p[0])); out[3] = Math.max(...points.map((p) => p[1]));
          },
          getShapeIter(part) {
            const points = coordinates(part);
            let i = -1;
            return { hasNext: () => ++i < points.length, get x() { return points[i][0]; }, get y() { return points[i][1]; } };
          },
        };
        function alpha(shapes, point, opacity = 1, options = {}) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 128;
          const painter = new CanvasPainter(canvas);
          painter.setPixelRatio(1);
          painter.drawPolygonFill(shapes, arcs, '#224488', undefined, opacity, options);
          return canvas.getContext('2d').getImageData(...point, 1, 1).data[3];
        }
        const tests = [
          ['overlap opaque', alpha([[[0]], [[1]]], [50, 50]), 255],
          ['coincident opaque', alpha([[[0]], [[0]]], [50, 50]), 255],
          ['overlap alpha', alpha([[[0]], [[1]]], [50, 50], 0.5), 192],
          ['single alpha', alpha([[[0]], [[1]]], [20, 20], 0.5), 128],
          ['hole', alpha([[[0], [2]], [[1]]], [30, 30]), 0],
          ['reversed hole', alpha([[[0], [~2]], [[1]]], [30, 30]), 0],
          ['hole feature overlaps another feature', alpha([[[0], [2]], [[1]]], [50, 50]), 255],
          ['100 coincident features', alpha(Array.from({ length: 100 }, () => [[0]]), [50, 50]), 255],
          ['101 coincident features', alpha(Array.from({ length: 101 }, () => [[0]]), [50, 50]), 255],
          ['style bucket overlap', alpha([[[0]], [[1]]], [50, 50], 1, { styleBuckets: { buckets: [new Uint32Array([0, 1])], colors: ['#224488'] } }), 255],
          ['viewport culling overlap', alpha([[[0], [2]], [[1]]], [50, 50], 1, { viewBBox: [45, 45, 55, 55] }), 255],
        ];
        return tests.map(([test, actual, expected]) => ({ test, actual, expected, passed: Math.abs(actual - expected) <= 1 }));
      });
      console.log(JSON.stringify({ browser: name, version: browser.version(), checks }, null, 2));
      if (checks.some((c) => !c.passed)) process.exitCode = 1;
    } finally { await browser.close(); }
  }
} finally { await new Promise((accept) => server.close(accept)); }
