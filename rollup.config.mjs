import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';
import { copyFileSync } from 'node:fs';

// `src/ui/controls.css` is a hand-maintained standalone stylesheet — it is
// NOT imported by any TS module, so postcss never sees it. Ship it as a
// first-class dist asset (`dist/emap.css`) so consumers can `import
// '@zwishing/emap/style.css'` instead of reaching into the unpublished src tree.
function copyControlsCss() {
  return {
    name: 'copy-controls-css',
    writeBundle() {
      copyFileSync('src/ui/controls.css', 'dist/emap.css');
    },
  };
}

const isProduction = process.env.BUILD === 'production';
const shouldWriteSourcemap = !isProduction;
const mainOutput = isProduction ? 'dist/emap.js' : 'dist/emap-dev.js';
const moduleOutput = 'dist/emap.mjs';
// Worker file is always called emap-worker.js so consumers don't have to
// branch by build mode. Minified in prod, sourcemapped in dev.
const workerOutput = 'dist/emap-worker.js';
// Vendor bundle filename is fixed too — referenced by URL from the worker
// banner and by users' page <script> tags.
const vendorOutput = 'dist/mapshaper-vendor.js';
const mapshaperGlobal = {
  mapshaper: 'mapshaper',
};

function commonPlugins() {
  return [
    alias({
      entries: [
        { find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' },
        { find: 'adm-zip', replacement: 'src/types/adm-zip-shim.ts' }
      ]
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false
    }),
    commonjs({
      ignoreDynamicRequires: true
    }),
    json(),
    postcss({
      inject: true,  // Inject CSS into <head>
      minimize: isProduction,
    }),
    nodePolyfills(),
    typescript({
      tsconfig: './tsconfig.json'
    }),
    isProduction && terser(),
  ];
}

export default [
  // Vendor IIFE — bundles mapshaper + the shim, registers
  // `globalThis.mapshaper` as a side effect of loading. Both the main and
  // worker bundles below treat `mapshaper` as an external global, so this
  // file MUST load before they execute (page <script> order, or worker
  // importScripts in the worker output's banner).
  {
    input: 'src/vendor/mapshaper-vendor.ts',
    output: {
      file: vendorOutput,
      format: 'iife',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: [...commonPlugins(), copyControlsCss()],
  },
  // ESM vendor — same browser mapshaper build as the IIFE vendor, but a real
  // ES module with `export default`. Imported by dist/emap.mjs (which marks
  // `mapshaper` external and rewrites the specifier to ./mapshaper-vendor.mjs).
  {
    input: 'src/vendor/mapshaper-vendor-esm.ts',
    external: ['maplibre-gl'],
    output: {
      file: 'dist/mapshaper-vendor.mjs',
      format: 'es',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: commonPlugins(),
  },
  // Main IIFE bundle exposing the `emap` global. Mapshaper is external here
  // because script-tag users load `mapshaper-vendor.js` first.
  {
    input: 'src/index.ts',
    external: ['mapshaper'],
    output: {
      file: mainOutput,
      format: 'iife',
      name: 'emap',
      sourcemap: shouldWriteSourcemap,
      inlineDynamicImports: true,
      globals: mapshaperGlobal,
    },
    plugins: commonPlugins(),
  },
  // Browser ESM bundle for Vite/Webpack/Bun consumers. Do NOT externalize
  // mapshaper here: its npm entry is Node-oriented CJS and can hit dynamic
  // `require("buffer")` in browsers. Bundling it with our browser polyfills
  // keeps the package self-contained for normal ESM imports.
  {
    input: 'src/index.ts',
    external: ['maplibre-gl'],
    output: {
      file: moduleOutput,
      format: 'es',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: commonPlugins(),
  },
  // Worker bundle. Same external/global treatment, plus a banner that
  // pulls the vendor file in via importScripts at boot — workers don't
  // share the page's <script> globals, so the worker has to re-load
  // mapshaper-vendor.js itself. Relative URL: vendor file is expected to
  // live in the same directory as the worker bundle.
  {
    input: 'src/worker/mapshaper-worker.ts',
    external: ['mapshaper'],
    output: {
      file: workerOutput,
      format: 'iife',
      sourcemap: shouldWriteSourcemap,
      banner: "importScripts('mapshaper-vendor.js');",
      globals: mapshaperGlobal,
    },
    plugins: commonPlugins(),
  },
];
