#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCdnAssets } from './check-example-cdn.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), '..');

export async function buildExamplesCdn({
  root = defaultRoot,
  fetchImpl = globalThis.fetch,
  spawnImpl = spawnSync,
} = {}) {
  const repositoryRoot = resolve(root);
  const packageManifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  );
  const integrity = await verifyCdnAssets({
    version: packageManifest.version,
    distDir: resolve(repositoryRoot, 'dist'),
    fetchImpl,
  });

  const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnImpl(command, ['--filter', '@mapseekai/emap-examples', 'build'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      EMAP_EXAMPLES_ASSET_MODE: 'cdn',
      EMAP_EXAMPLES_ASSET_INTEGRITY: JSON.stringify(integrity),
    },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    const outcome = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    throw new Error(`CDN examples build failed with ${outcome}`);
  }

  return integrity;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    await buildExamplesCdn();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
