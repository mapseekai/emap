import { access, readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const requiredBundles = [
  'dist/emap.mjs',
  'dist/emap.js',
  'dist/emap-worker.js',
  'dist/emap-geometry-worker.js',
  'dist/emap-arrow.mjs',
  'dist/emap-arrow.js',
  'dist/emap-duckdb.mjs',
  'dist/mapshaper-vendor.mjs',
  'dist/mapshaper-vendor.js',
  'dist/emap.css',
  'dist/index.d.ts',
];

for (const relativePath of requiredBundles) {
  const path = resolve(root, relativePath);
  await access(path);
  if ((await stat(path)).size === 0) {
    throw new Error(`Bundle smoke check failed: ${relativePath} is empty`);
  }
}

const browserJavaScript = (await readdir(resolve(root, 'dist'))).filter(path => /\.(?:m?js)$/.test(path)).map(path => `dist/${path}`);
const forbiddenNodeRuntimePatterns = [
  /(?:from\s*|import\s*\()\s*['"]node:/,
  /\brequire\s*\(\s*['"](?:assert|buffer|child_process|crypto|fs|http|https|os|path|stream|url|util|worker_threads)(?:\/[^'"]*)?['"]\s*\)/,
];

for (const relativePath of browserJavaScript) {
  const source = await readFile(resolve(root, relativePath), 'utf8');
  for (const pattern of forbiddenNodeRuntimePatterns) {
    if (pattern.test(source)) {
      throw new Error(
        `Bundle smoke check failed: ${relativePath} contains a Node-only runtime import matching ${pattern}`,
      );
    }
  }
}

const packageJson = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const exportTargets = new Set();

function collectExportTargets(value) {
  if (typeof value === 'string') {
    if (value.startsWith('./dist/')) exportTargets.add(value.slice(2));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const nested of Object.values(value)) collectExportTargets(nested);
}

collectExportTargets(packageJson.exports);
for (const relativePath of exportTargets) {
  await access(resolve(root, relativePath));
}

console.log(
  `Bundle smoke check passed: ${requiredBundles.length} required files and ${exportTargets.size} package export targets verified.`,
);
