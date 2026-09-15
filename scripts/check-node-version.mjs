import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const range = packageJson.engines?.node;
const match = typeof range === 'string' ? range.match(/^>=(\d+)\.(\d+)(?:\.(\d+))?\s+<(\d+)$/) : null;

if (!match) {
  throw new Error(`Unsupported engines.node range: ${String(range)}`);
}

const [, minMajorText, minMinorText, minPatchText = '0', maxMajorText] = match;
const minimum = [Number(minMajorText), Number(minMinorText), Number(minPatchText)];
const maximumMajor = Number(maxMajorText);
const current = process.versions.node.split('.').map(Number);
const belowMinimum = current[0] < minimum[0]
  || (current[0] === minimum[0] && current[1] < minimum[1])
  || (current[0] === minimum[0] && current[1] === minimum[1] && current[2] < minimum[2]);
const aboveMaximum = current[0] >= maximumMajor;

if (belowMinimum || aboveMaximum) {
  console.error(`Unsupported Node.js ${process.version}. emap requires Node.js ${range}.`);
  console.error('Use the repository .node-version before running build/release commands.');
  process.exit(1);
}

console.log(`Node.js ${process.version} satisfies ${range}.`);
