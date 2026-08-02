#!/usr/bin/env node
import { cp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileExists, parseRootArg, relativePath } from './docs-check-utils.mjs';

const root = parseRootArg();
const examplesDist = resolve(root, 'packages/examples/dist');
const docsBuild = resolve(root, 'packages/docs/build');
const composedExamples = resolve(docsBuild, 'examples');
const nestedExamplesInput = resolve(examplesDist, 'examples');

if (await fileExists(nestedExamplesInput)) {
  throw new Error(
    `Nested examples directory is not allowed: ${relativePath(root, nestedExamplesInput)}`,
  );
}

const requiredInputs = [
  resolve(examplesDist, 'index.html'),
  resolve(examplesDist, 'buffer/index.html'),
  resolve(examplesDist, 'emap.svg'),
  resolve(examplesDist, 'emap-worker.js'),
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
  resolve(composedExamples, 'buffer/index.html'),
  resolve(composedExamples, 'emap.svg'),
  resolve(composedExamples, 'emap-worker.js'),
  resolve(composedExamples, 'assets'),
];

for (const output of requiredOutputs) {
  if (!(await fileExists(output))) {
    throw new Error(`Missing composed examples output: ${relativePath(root, output)}`);
  }
}

const nestedExamplesOutput = resolve(composedExamples, 'examples');
if (await fileExists(nestedExamplesOutput)) {
  throw new Error(
    `Nested examples directory is not allowed: ${relativePath(root, nestedExamplesOutput)}`,
  );
}

console.log('Composed examples at packages/docs/build/examples for /mapseekai/emap/examples/.');
