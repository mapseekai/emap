#!/usr/bin/env node
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileExists, parseRootArg, relativePath } from './docs-check-utils.mjs';

const root = parseRootArg();
const examplesDist = resolve(root, 'packages/examples/dist');
const docsBuild = resolve(root, 'packages/docs/build');
const composedExamples = resolve(docsBuild, 'examples');

const requiredInputs = [
  resolve(examplesDist, 'index.html'),
  resolve(examplesDist, 'examples/buffer/index.html'),
  resolve(docsBuild, 'index.html'),
];

for (const input of requiredInputs) {
  if (!(await fileExists(input))) {
    throw new Error(`Missing release input: ${relativePath(root, input)}`);
  }
}

await rm(composedExamples, { recursive: true, force: true });
await cp(examplesDist, composedExamples, { recursive: true });

const requiredOutputs = [
  resolve(composedExamples, 'index.html'),
  resolve(composedExamples, 'examples/buffer/index.html'),
  resolve(composedExamples, 'assets'),
];

for (const output of requiredOutputs) {
  if (!(await fileExists(output))) {
    throw new Error(`Missing composed examples output: ${relativePath(root, output)}`);
  }
}

console.log('Composed examples at packages/docs/build/examples for /emap/examples/.');
