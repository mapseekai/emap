import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import nodePolyfills from 'rollup-plugin-polyfill-node';
import terser from '@rollup/plugin-terser';
import alias from '@rollup/plugin-alias';
import json from '@rollup/plugin-json';

const isProduction = process.env.BUILD === 'production';
const outputFile = isProduction ? 'dist/mapseek.js' : 'dist/mapseek-dev.js';

export default {
  input: 'src/index.ts',
  output: {
    file: outputFile,
    format: 'iife',
    name: 'mapseek',
    sourcemap: true,
  },
  plugins: [
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
    nodePolyfills(),
    typescript({
      tsconfig: './tsconfig.json'
    }),
    isProduction && terser()
  ]
};
