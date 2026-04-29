import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';
import postcss from 'rollup-plugin-postcss';

const isProduction = process.env.BUILD === 'production';
const mainOutput = isProduction ? 'dist/emap.js' : 'dist/emap-dev.js';
const moduleOutput = 'dist/emap.mjs';
// Worker file is always called emap-worker.js so consumers don't have to
// branch by build mode. Minified in prod, sourcemapped in dev.
const workerOutput = 'dist/emap-worker.js';
// Vendor bundle filename is fixed too — referenced by URL from the worker
// banner and by users' page <script> tags.
const vendorOutput = 'dist/mapshaper-vendor.js';

function commonPlugins() {
  return [
    alias({
      entries: [
        { find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' }
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
      sourcemap: true,
    },
    plugins: commonPlugins(),
  },
  // Main IIFE bundle exposing the `emap` global. Mapshaper is `external`
  // — the bundle expects `globalThis.mapshaper` set by the vendor file.
  {
    input: 'src/index.ts',
    external: ['mapshaper'],
    output: [
      {
        file: mainOutput,
        format: 'iife',
        name: 'emap',
        sourcemap: true,
        globals: {
          mapshaper: 'mapshaper',
        },
      },
      {
        file: moduleOutput,
        format: 'es',
        sourcemap: true,
      },
    ],
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
      sourcemap: true,
      banner: "importScripts('mapshaper-vendor.js');",
      globals: {
        mapshaper: 'mapshaper',
      },
    },
    plugins: commonPlugins(),
  },
];
