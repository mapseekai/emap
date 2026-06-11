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

// mapshaper's CJS browser fallback chooses `require` before `window.modules`.
// That is safe in Rollup production output, but Vite dev pre-bundling runs
// through esbuild, which injects a callable `__require` shim. If that shim wins,
// mapshaper tries `__require("iconv-lite")` at module evaluation time and
// crashes in the browser. The vendor bundle is browser-targeted, so prefer the
// browser module registry and keep require only as a non-browser fallback.
function preferBrowserMapshaperModules() {
  const patterns = [
    {
      from: /"function"==typeof require\?require:"object"==typeof window&&window\.modules\?function\((\w+)\)\{return window\.modules\[\1\]\}:function\(\)\{\}/g,
      to: '"object"==typeof window&&window.modules?function($1){return window.modules[$1]}:"function"==typeof require?require:function(){}',
    },
    {
      // Unminified (dev) vendor: mapshaper emits the loader as an
      // if / else-if / else block, not a ternary (terser never runs in dev
      // to collapse it). Match the block and reorder it to prefer
      // `window.modules` over `require` — same intent as the minified
      // pattern above.
      from: /if \(typeof require == 'function'\) \{[\s\S]*?f = require;[\s\S]*?\} else if \(typeof window == 'object' && window\.modules\) \{[\s\S]*?f = function\s*\((\w+)\) \{\s*return window\.modules\[\1\];\s*\};[\s\S]*?\} else \{[\s\S]*?f = function\s*\(\) \{\};?[\s\S]*?\}/g,
      to: [
        "if (typeof window == 'object' && window.modules) {",
        '        f = function ($1) { return window.modules[$1]; };',
        "      } else if (typeof require == 'function') {",
        '        f = require;',
        '      } else {',
        '        f = function () {};',
        '      }',
      ].join('\n'),
    },
  ];

  return {
    name: 'prefer-browser-mapshaper-modules',
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.fileName.startsWith('mapshaper-vendor.')) continue;

        let code = chunk.code;
        for (const { from, to } of patterns) {
          code = code.replace(from, to);
        }
        if (code === chunk.code) {
          this.error(`Unable to patch mapshaper module loader in ${chunk.fileName}`);
        }
        chunk.code = code;
      }
    },
  };
}

// mproj@0.1.x ships ESM/CJS bundles, but its init-file fallback still embeds
// Node-only require("fs") / require("path") calls for loading nad/epsg files.
// emap browser bundles are self-contained; CRS library definitions must be
// preloaded into mproj's libcache instead of read from disk at runtime.
function browserSafeMprojInitFallback() {
  const readLibPattern =
    /function mproj_read_lib_anycase\(libFile\) \{[\s\S]*?return contents;\n\}/;
  const replacement = [
    'function mproj_read_lib_anycase(libFile) {',
    "  fatal('unable to read from \\'init\\' file named ' + libFile);",
    '}',
  ].join('\n');

  return {
    name: 'browser-safe-mproj-init-fallback',
    transform(code, id) {
      const normalizedId = id.replaceAll('\\', '/');
      if (!normalizedId.includes('/node_modules/mproj/dist/')) return null;
      if (!code.includes('function mproj_read_lib_anycase')) return null;
      const patched = code.replace(readLibPattern, replacement);
      if (patched === code) {
        this.error('Unable to patch mproj init-file fallback');
      }
      return { code: patched, map: null };
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

function quietKnownPolyfillCircularWarnings(warning, warn) {
  if (
    warning.code === 'CIRCULAR_DEPENDENCY' &&
    (warning.message?.includes('polyfill-node._stream_') ||
      warning.ids?.some((id) => id.includes('polyfill-node._stream_')))
  ) {
    return;
  }
  warn(warning);
}

function commonPlugins() {
  return [
    alias({
      entries: [{ find: 'iconv-lite', replacement: 'src/types/iconv-shim.ts' }],
    }),
    nodeResolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs({
      ignoreDynamicRequires: true,
    }),
    json(),
    postcss({
      inject: true, // Inject CSS into <head>
      minimize: isProduction,
    }),
    nodePolyfills(),
    browserSafeMprojInitFallback(),
    typescript({
      tsconfig: './tsconfig.json',
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
    onwarn: quietKnownPolyfillCircularWarnings,
    output: {
      file: vendorOutput,
      format: 'iife',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: [...commonPlugins(), preferBrowserMapshaperModules(), copyControlsCss()],
  },
  // ESM vendor — same browser mapshaper build as the IIFE vendor, but a real
  // ES module with `export default`. Imported by dist/emap.mjs (which marks
  // `mapshaper` external and rewrites the specifier to ./mapshaper-vendor.mjs).
  {
    input: 'src/vendor/mapshaper-vendor-esm.ts',
    external: ['maplibre-gl'],
    onwarn: quietKnownPolyfillCircularWarnings,
    output: {
      file: 'dist/mapshaper-vendor.mjs',
      format: 'es',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: [...commonPlugins(), preferBrowserMapshaperModules()],
  },
  // Main IIFE bundle exposing the `emap` global. Mapshaper is external here
  // because script-tag users load `mapshaper-vendor.js` first.
  {
    input: 'src/index.ts',
    external: ['mapshaper'],
    onwarn: quietKnownPolyfillCircularWarnings,
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
  // Browser ESM bundle for Vite/Webpack/Bun consumers. mapshaper is EXTERNAL
  // here and rewritten to the sibling ESM vendor — it must NOT go through
  // @rollup/plugin-commonjs (that path produced the Friction #8 fragility:
  // dead require("adm-zip") and a runtime-throwing iconv-lite helper).
  {
    input: 'src/index.ts',
    external: ['maplibre-gl', 'mapshaper'],
    onwarn: quietKnownPolyfillCircularWarnings,
    output: {
      file: moduleOutput,
      format: 'es',
      sourcemap: shouldWriteSourcemap,
      paths: { mapshaper: './mapshaper-vendor.mjs' },
    },
    plugins: commonPlugins(),
  },
  // Formats ESM bundle (`@zwishing/emap/formats`) — optional GeoParquet /
  // GeoArrow support. apache-arrow is bundled INTO this file (it is not a
  // core dependency); parquet-wasm stays external and loads lazily via
  // dynamic import in the consumer's bundler. mapshaper is external and
  // rewritten to the ESM vendor like the main module bundle.
  // apache-arrow v21 ships `sideEffects:false` ESM that breaks when
  // tree-shaken aggressively — keep its module side effects.
  {
    input: 'src/formats/index.ts',
    external: ['maplibre-gl', 'mapshaper', 'parquet-wasm'],
    onwarn: quietKnownPolyfillCircularWarnings,
    treeshake: {
      // Keep emap's own side effects (plugin registration in the entry) and
      // apache-arrow's; everything else may be shaken normally.
      moduleSideEffects: (id) => id.includes('apache-arrow') || !id.includes('node_modules'),
    },
    output: {
      file: 'dist/emap-formats.mjs',
      format: 'es',
      sourcemap: shouldWriteSourcemap,
      paths: { mapshaper: './mapshaper-vendor.mjs' },
    },
    plugins: commonPlugins(),
  },
  // Formats IIFE bundle for script-tag users (global `emapFormats`).
  // parquet-wasm cannot be dynamically imported from an IIFE — GeoParquet
  // users must call setParquetWasm() with a self-initialized module (the
  // loader's error message says exactly that). GeoArrow needs no wasm.
  {
    input: 'src/formats/index.ts',
    external: ['mapshaper', 'parquet-wasm'],
    onwarn: quietKnownPolyfillCircularWarnings,
    treeshake: {
      // Keep emap's own side effects (plugin registration in the entry) and
      // apache-arrow's; everything else may be shaken normally.
      moduleSideEffects: (id) => id.includes('apache-arrow') || !id.includes('node_modules'),
    },
    output: {
      file: 'dist/emap-formats.js',
      format: 'iife',
      name: 'emapFormats',
      sourcemap: shouldWriteSourcemap,
      inlineDynamicImports: true,
      globals: { ...mapshaperGlobal, 'parquet-wasm': 'parquetWasm' },
    },
    plugins: commonPlugins(),
  },
  // ESM bundle (`@zwishing/emap/duckdb`) — optional DuckDB-Wasm spatial
  // processing support. Keep DuckDB runtime dependencies external/lazy so
  // the main and formats bundles stay light.
  {
    input: 'src/duckdb/index.ts',
    external: ['@duckdb/duckdb-wasm', 'apache-arrow'],
    onwarn: quietKnownPolyfillCircularWarnings,
    output: {
      file: 'dist/emap-duckdb.mjs',
      format: 'es',
      sourcemap: shouldWriteSourcemap,
    },
    plugins: commonPlugins(),
  },

  // IIFE bundle for script-tag users (global `emapDuckDb`).
  {
    input: 'src/duckdb/index.ts',
    external: ['@duckdb/duckdb-wasm', 'apache-arrow'],
    onwarn: quietKnownPolyfillCircularWarnings,
    output: {
      file: 'dist/emap-duckdb.js',
      format: 'iife',
      name: 'emapDuckDb',
      sourcemap: shouldWriteSourcemap,
      globals: {
        '@duckdb/duckdb-wasm': 'duckdb',
        'apache-arrow': 'Arrow',
      },
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
    onwarn: quietKnownPolyfillCircularWarnings,
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
