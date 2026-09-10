#!/usr/bin/env node
// Node timings measure the LOD algorithm, not Canvas rendering or browser FPS.
// Run: node --expose-gc --max-old-space-size=8192 scripts/benchmark-point-lod.mjs
import { build } from 'esbuild';
import { performance } from 'node:perf_hooks';
import { platform, arch, cpus } from 'node:os';

const bundled = await build({
  stdin: {
    contents: `export { PointLod } from './src/renderer/point-lod.ts'; export { AffineTransform } from './src/geo/transform.ts';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
});
const { PointLod, AffineTransform } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString('base64')}`
);
const counts = process.argv.slice(2).map(Number);
if (counts.some((count) => !Number.isInteger(count) || count < 10_000))
  throw new Error('Counts must be integers >= 10000');
const sizes = counts.length ? counts : [100_000, 1_000_000, 5_000_000];
const seed = 0x5eed1234;
const transform = new AffineTransform(1, -1);
const spec = { id: 'points', source: 'benchmark', type: 'circle' };
const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ];
console.log(
  JSON.stringify({
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    seed,
    coldRuns: 3,
    warmPans: 50,
    cssCellSize: 8,
  }),
);
console.log(
  'distribution,inputPoints,representatives,coldMedianMs,warmMedianMs,warmP95Ms,warmMeanPoints',
);
for (const count of sizes) {
  for (const distribution of ['uniform', 'clustered']) {
    globalThis.gc?.();
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    const shapes = Array.from({ length: count }, (_, id) => {
      if (distribution === 'uniform') return [[random() * 1000 - 500, random() * 1000 - 500]];
      const cluster = id % 16;
      return [
        [
          (cluster % 4) * 240 - 360 + (random() + random() + random() - 1.5) * 12,
          Math.floor(cluster / 4) * 240 - 360 + (random() + random() + random() - 1.5) * 12,
        ],
      ];
    });
    const layer = { geometry_type: 'point', shapes };
    const dataset = { layers: [layer] };
    const cold = [];
    let lod;
    let representatives;
    for (let repeat = 0; repeat < 3; repeat++) {
      lod?.clear();
      globalThis.gc?.();
      lod = new PointLod();
      const start = performance.now();
      const selection = lod.query(spec, layer, dataset, null, transform, [-512, -512, 512, 512]);
      cold.push(performance.now() - start);
      if (!selection) throw new Error('Expected dense LOD level');
      representatives = selection.featureIds.length;
    }
    const warm = [];
    let output = 0;
    for (let pan = 0; pan < 50; pan++) {
      const x = -450 + pan * 10;
      const start = performance.now();
      const selection = lod.query(spec, layer, dataset, null, transform, [x, -180, x + 400, 180]);
      warm.push(performance.now() - start);
      output += selection.featureIds.length;
    }
    console.log(
      [
        distribution,
        count,
        representatives,
        percentile(cold, 0.5).toFixed(3),
        percentile(warm, 0.5).toFixed(3),
        percentile(warm, 0.95).toFixed(3),
        (output / 50).toFixed(1),
      ].join(','),
    );
    lod.clear();
  }
}

// The formerly failing ordinary-view scale transition, with a separate full
// viewport budget even when a pointer performs the first query at the new scale.
for (const [width, height] of [
  [1920, 1080],
  [3840, 2160],
]) {
  globalThis.gc?.();
  let state = 12345;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const layer = {
    geometry_type: 'point',
    shapes: Array.from({ length: 1_000_000 }, () => [
      [(random() * width) / 2, (random() * height) / 2],
    ]),
  };
  const dataset = { layers: [layer] };
  const lod = new PointLod();
  const bounds = [0, 0, width / 2, height / 2];
  const view = { width, height };
  const coarse = lod.query(spec, layer, dataset, null, new AffineTransform(2, -2), bounds, view);
  lod.query(spec, layer, dataset, null, new AffineTransform(2.001, -2.001), [10, 10, 11, 11], view);
  const fine = lod.query(
    spec,
    layer,
    dataset,
    null,
    new AffineTransform(2.001, -2.001),
    bounds,
    view,
  );
  if (!coarse || !fine) throw new Error('Dense viewport lost LOD');
  console.log(
    JSON.stringify({
      viewport: `${width}x${height}`,
      inputPoints: 1_000_000,
      scale2: coarse.featureIds.length,
      scale2_001: fine.featureIds.length,
    }),
  );
  lod.clear();
}
