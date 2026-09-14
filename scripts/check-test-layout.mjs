import fs from 'node:fs';
import path from 'node:path';

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

const violations = [];
const unitTests = files('src').filter((file) => /\.test\.(?:ts|tsx)$/.test(file));
const owners = new Map();
for (const test of unitTests) {
  const source = test.replace(/\.test\.(ts|tsx)$/, '.$1');
  if (!fs.existsSync(source)) violations.push(`${test}: missing colocated implementation ${source}`);
  const previous = owners.get(source);
  if (previous) violations.push(`${source}: multiple unit tests (${previous}, ${test})`);
  owners.set(source, test);
}

for (const file of files('src')) {
  if (/\.(?:spec|integration|audit)\.(?:ts|tsx)$/.test(file) || file.endsWith('.test-d.ts')) {
    violations.push(`${file}: integration/type-contract tests belong under test/`);
  }
}

if (violations.length) throw new Error(violations.join('\n'));
console.log(`Test layout verified: ${unitTests.length} colocated unit tests; integration and type-contract tests are outside src/.`);
