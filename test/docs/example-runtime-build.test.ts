// @vitest-environment node
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { rollup } from 'rollup';
import { describe, expect, it } from 'vitest';
import { createPluginMiddleware } from '../utils/vite-plugin';
import { runtimeAssetsPlugin } from '../../packages/examples/build/runtime-assets-plugin';

const repoRoot = process.cwd();

type RuntimeMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
) => void;

async function invokeMiddleware(
  middleware: RuntimeMiddleware,
  url: string,
): Promise<
  { body: Buffer; headers: Map<string, string | number>; statusCode: number } | undefined
> {
  return new Promise((resolveResponse, rejectResponse) => {
    const headers = new Map<string, string | number>();
    const response = {
      statusCode: 0,
      end(chunk?: Uint8Array) {
        resolveResponse({
          body: chunk ? Buffer.from(chunk) : Buffer.alloc(0),
          headers,
          statusCode: this.statusCode,
        });
      },
      setHeader(name: string, value: string | number) {
        headers.set(name.toLowerCase(), value);
      },
    } as ServerResponse;

    middleware({ method: 'GET', url } as IncomingMessage, response, (error?: unknown) => {
      if (error) rejectResponse(error);
      else resolveResponse(undefined);
    });
  });
}

describe('example runtime build assets', () => {
  it('emits local runtime and same-origin worker assets from the build plugin', async () => {
    const bundle = await rollup({
      input: 'virtual:example-runtime-entry',
      plugins: [
        {
          name: 'virtual-example-runtime-entry',
          resolveId(id) {
            return id === 'virtual:example-runtime-entry' ? id : null;
          },
          load(id) {
            return id === 'virtual:example-runtime-entry' ? 'export {};' : null;
          },
        },
        runtimeAssetsPlugin(),
      ],
    });
    const generated = await bundle.generate({ format: 'es' });
    await bundle.close();

    const expectedOutputs = [
      ['dist/mapshaper-vendor.js', 'vendor/mapshaper-vendor.js'],
      ['dist/emap.js', 'vendor/emap.js'],
      ['dist/emap.css', 'vendor/emap.css'],
      ['dist/emap-worker.js', 'emap-worker.js'],
      ['dist/emap-geopackage-worker.js', 'emap-geopackage-worker.js'],
      ['dist/sql-wasm.wasm', 'sql-wasm.wasm'],
      // Worker sibling: emap-worker.js boots with a relative
      // importScripts('mapshaper-vendor.js'), so the vendor file must also
      // be emitted next to the worker bundle.
      ['dist/mapshaper-vendor.js', 'mapshaper-vendor.js'],
    ] as const;

    for (const [source, fileName] of expectedOutputs) {
      const sourceBytes = await readFile(resolve(repoRoot, source));
      const output = generated.output.find(
        (entry) => entry.type === 'asset' && entry.fileName === fileName,
      );
      expect(output?.type).toBe('asset');
      if (!output || output.type !== 'asset') throw new Error(`Missing emitted asset: ${fileName}`);
      const outputBytes = Buffer.from(output.source);
      expect(outputBytes.byteLength).toBe(sourceBytes.byteLength);
      expect(outputBytes.equals(sourceBytes)).toBe(true);
    }
  }, 30_000);

  it('serves only declared local runtime files from the development middleware', async () => {
    const server = await createPluginMiddleware(runtimeAssetsPlugin(), {
      root: resolve('packages/examples'),
      base: '/mapseekai/emap/examples/',
    });
    const runtimeMiddleware = server.middlewares;
    try {
      const vendorResponse = await invokeMiddleware(
        runtimeMiddleware,
        '/mapseekai/emap/examples/vendor/mapshaper-vendor.js',
      );
      expect(vendorResponse?.statusCode).toBe(200);
      expect(vendorResponse?.headers.get('content-type')).toContain('application/javascript');
      const vendorBytes = await readFile(resolve(repoRoot, 'dist/mapshaper-vendor.js'));
      expect(vendorResponse?.body.byteLength).toBe(vendorBytes.byteLength);
      expect(vendorResponse?.body.equals(vendorBytes)).toBe(true);

      const workerSiblingResponse = await invokeMiddleware(
        runtimeMiddleware,
        '/mapseekai/emap/examples/mapshaper-vendor.js',
      );
      expect(workerSiblingResponse?.statusCode).toBe(200);
      expect(workerSiblingResponse?.body.equals(vendorBytes)).toBe(true);

      await expect(
        invokeMiddleware(runtimeMiddleware, '/mapseekai/emap/examples/vendor/package.json'),
      ).resolves.toBeUndefined();
    } finally {
      await server.close();
    }
  });
});
