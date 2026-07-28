#!/usr/bin/env node
import { lstat, readdir, rename, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRoot = resolve(dirname(scriptPath), '..');

export async function normalizeExamplesBuild(root) {
  if (typeof root !== 'string' || root.trim() === '') {
    throw new TypeError('normalizeExamplesBuild root must be a non-empty path');
  }

  const repositoryRoot = resolve(root);
  const dist = resolve(repositoryRoot, 'packages/examples/dist');
  const staging = resolve(dist, 'examples');
  assertDescendant(dist, staging, 'staging directory');

  const stagingStats = await lstat(staging).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing staged examples directory: ${relative(repositoryRoot, staging)}`);
    }
    throw error;
  });
  if (!stagingStats.isDirectory() || stagingStats.isSymbolicLink()) {
    throw new Error(`Staged examples path must be a real directory: ${relative(repositoryRoot, staging)}`);
  }

  const entries = await readdir(staging, { withFileTypes: true });
  if (entries.length === 0) {
    throw new Error(`Staged examples directory is empty: ${relative(repositoryRoot, staging)}`);
  }

  const moves = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error(`Unexpected staged examples entry: ${entry.name}`);
    }
    const source = resolve(staging, entry.name);
    const destination = resolve(dist, entry.name);
    assertDescendant(staging, source, 'route source');
    assertDescendant(dist, destination, 'route destination');
    if (await pathExists(destination)) {
      throw new Error(`Examples route destination already exists: ${relative(dist, destination)}`);
    }
    moves.push({ source, destination });
  }

  for (const move of moves) {
    await rename(move.source, move.destination);
  }
  await rmdir(staging);
}

function assertDescendant(parent, candidate, label) {
  const path = relative(parent, candidate);
  if (path === '' || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) {
    throw new Error(`Unsafe examples build ${label}: ${candidate}`);
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseCliRoot(args) {
  if (args.length === 0) return defaultRoot;
  if (args.length === 2 && args[0] === '--root' && args[1]) return args[1];
  throw new Error('Usage: normalize-examples-build.mjs [--root <repository-root>]');
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await normalizeExamplesBuild(parseCliRoot(process.argv.slice(2)));
}
