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
// Worker file is always called emap-worker.js so consumers don't have to
// branch by build mode. Minified in prod, sourcemapped in dev.
const workerOutput = 'dist/emap-worker.js';

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
  // Main IIFE bundle exposing the `emap` global.
  {
    input: 'src/index.ts',
    output: {
      file: mainOutput,
      format: 'iife',
      name: 'emap',
      sourcemap: true,
    },
    plugins: commonPlugins(),
  },
  // Worker bundle. No global name needed — the worker bundle's IIFE only
  // wires up self.onmessage; consumers never reference its exports.
  {
    input: 'src/worker/mapshaper-worker.ts',
    output: {
      file: workerOutput,
      format: 'iife',
      sourcemap: true,
    },
    plugins: commonPlugins(),
  },
];
