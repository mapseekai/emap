import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const assets = [
  { name: 'vendor', fileName: 'mapshaper-vendor.js' },
  { name: 'core', fileName: 'emap.js' },
  { name: 'css', fileName: 'emap.css' },
];

export async function verifyCdnAssets({ version, distDir, fetchImpl = globalThis.fetch }) {
  if (typeof version !== 'string' || !exactVersionPattern.test(version)) {
    throw new Error('CDN assets require an exact package version');
  }
  if (typeof distDir !== 'string' || distDir.trim() === '') {
    throw new TypeError('CDN asset distDir must be a non-empty path');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('CDN asset fetchImpl must be a function');
  }

  const localAssets = new Map();
  for (const asset of assets) {
    const path = resolve(distDir, asset.fileName);
    try {
      localAssets.set(asset.name, await readFile(path));
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Missing local CDN comparison asset: ${path}`);
      }
      throw error;
    }
  }

  const integrity = {};
  for (const asset of assets) {
    const url = `https://cdn.jsdelivr.net/npm/@mapseekai/emap@${version}/dist/${asset.fileName}`;
    let response;
    try {
      response = await fetchImpl(url);
    } catch (error) {
      throw new Error(`Unable to fetch CDN asset ${url}: ${errorMessage(error)}`, { cause: error });
    }
    if (!response?.ok) {
      throw new Error(`CDN asset ${url} returned HTTP ${response?.status ?? 'unknown'}`);
    }

    const localBytes = localAssets.get(asset.name);
    const cdnBytes = Buffer.from(await response.arrayBuffer());
    if (!localBytes.equals(cdnBytes)) {
      throw new Error(`CDN asset ${asset.fileName} does not match local dist bytes`);
    }

    integrity[asset.name] = `sha384-${createHash('sha384').update(localBytes).digest('base64')}`;
  }

  return integrity;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
