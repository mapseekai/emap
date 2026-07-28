import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

interface RuntimeAssetEntry {
  requestPath: string;
  buildPath: string;
  developmentSource: string;
  productionSource: string;
  contentType: string;
}

const workingDirectory = resolve(process.cwd());
const repoRoot = existsSync(resolve(workingDirectory, 'packages/examples/package.json'))
  ? workingDirectory
  : resolve(workingDirectory, '../..');
const examplesRoot = resolve(repoRoot, 'packages/examples');
const sourceRoot = resolve(repoRoot, 'dist');
const examplesBuildRoot = resolve(examplesRoot, 'dist');

const runtimeAssetEntries: readonly RuntimeAssetEntry[] = [
  {
    requestPath: 'vendor/mapshaper-vendor.js',
    buildPath: 'vendor/mapshaper-vendor.js',
    developmentSource: 'mapshaper-vendor.js',
    productionSource: 'mapshaper-vendor.js',
    contentType: 'application/javascript; charset=utf-8',
  },
  {
    requestPath: 'vendor/emap.js',
    buildPath: 'vendor/emap.js',
    developmentSource: 'emap-dev.js',
    productionSource: 'emap.js',
    contentType: 'application/javascript; charset=utf-8',
  },
  {
    requestPath: 'vendor/emap.css',
    buildPath: 'vendor/emap.css',
    developmentSource: 'emap.css',
    productionSource: 'emap.css',
    contentType: 'text/css; charset=utf-8',
  },
  {
    requestPath: 'emap-worker.js',
    buildPath: 'emap-worker.js',
    developmentSource: 'emap-worker.js',
    productionSource: 'emap-worker.js',
    contentType: 'application/javascript; charset=utf-8',
  },
] as const;

function assertInside(root: string, candidate: string, label: string): string {
  const pathFromRoot = relative(root, candidate);
  if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot)) {
    throw new Error(`${label} must stay inside ${root}: ${candidate}`);
  }
  return candidate;
}

function sourcePath(fileName: string): string {
  return assertInside(sourceRoot, resolve(sourceRoot, fileName), 'Runtime asset source');
}

function publicRequestPath(base: string, requestPath: string): string {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${requestPath}`;
}

export function runtimeAssetsPlugin(): Plugin {
  let outputRoot = examplesBuildRoot;

  return {
    name: 'emap-example-runtime-assets',
    configResolved(config) {
      outputRoot = resolve(config.root, config.build.outDir);
      for (const asset of runtimeAssetEntries) {
        assertInside(
          examplesBuildRoot,
          resolve(outputRoot, asset.buildPath),
          'Runtime asset build target',
        );
      }
    },
    configureServer(server) {
      const requestToAsset = new Map(
        runtimeAssetEntries.map((asset) => [
          publicRequestPath(server.config.base, asset.requestPath),
          asset,
        ]),
      );

      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          next();
          return;
        }

        const pathname = new URL(request.url ?? '/', 'http://vite.local').pathname;
        const asset = requestToAsset.get(pathname);
        if (!asset) {
          next();
          return;
        }

        const filePath = sourcePath(asset.developmentSource);
        void readFile(filePath)
          .then((source) => {
            response.statusCode = 200;
            response.setHeader('Content-Type', asset.contentType);
            response.setHeader('Content-Length', source.byteLength);
            response.end(request.method === 'HEAD' ? undefined : source);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      for (const asset of runtimeAssetEntries) {
        assertInside(
          examplesBuildRoot,
          resolve(outputRoot, asset.buildPath),
          'Runtime asset build target',
        );
        this.emitFile({
          type: 'asset',
          fileName: asset.buildPath,
          source: await readFile(sourcePath(asset.productionSource)),
        });
      }
    },
  };
}
