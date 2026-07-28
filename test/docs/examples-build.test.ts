// @vitest-environment node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('examples build routes', () => {
  it('normalizes flat and getting-started routes without disturbing shared assets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-examples-build-'));
    const dist = resolve(root, 'packages/examples/dist');

    try {
      await mkdir(resolve(dist, 'assets'), { recursive: true });
      await mkdir(resolve(dist, 'fixtures'), { recursive: true });
      await mkdir(resolve(dist, 'vendor'), { recursive: true });
      await mkdir(resolve(dist, 'examples/buffer'), { recursive: true });
      await mkdir(resolve(dist, 'examples/getting-started/points'), { recursive: true });
      await writeFile(resolve(dist, 'index.html'), '<!doctype html>');
      await writeFile(resolve(dist, 'assets/main.js'), 'export {};');
      await writeFile(resolve(dist, 'fixtures/points.geojson'), '{}');
      await writeFile(resolve(dist, 'vendor/emap.js'), 'globalThis.emap = {};');
      await writeFile(resolve(dist, 'examples/buffer/index.html'), 'buffer');
      await writeFile(resolve(dist, 'examples/getting-started/points/index.html'), 'points');

      const { normalizeExamplesBuild } = await import('../../scripts/normalize-examples-build.mjs');
      await normalizeExamplesBuild(root);

      expect(await readFile(resolve(dist, 'buffer/index.html'), 'utf8')).toBe('buffer');
      expect(await readFile(resolve(dist, 'getting-started/points/index.html'), 'utf8')).toBe(
        'points',
      );
      expect(await exists(resolve(dist, 'examples'))).toBe(false);
      expect(await exists(resolve(dist, 'assets/main.js'))).toBe(true);
      expect(await exists(resolve(dist, 'fixtures/points.geojson'))).toBe(true);
      expect(await exists(resolve(dist, 'vendor/emap.js'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects every destination conflict before moving staged routes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-examples-conflict-'));
    const dist = resolve(root, 'packages/examples/dist');

    try {
      await mkdir(resolve(dist, 'examples/attribute-editing'), { recursive: true });
      await mkdir(resolve(dist, 'examples/buffer'), { recursive: true });
      await mkdir(resolve(dist, 'buffer'), { recursive: true });
      await writeFile(resolve(dist, 'examples/attribute-editing/index.html'), 'attribute');
      await writeFile(resolve(dist, 'examples/buffer/index.html'), 'staged buffer');
      await writeFile(resolve(dist, 'buffer/index.html'), 'existing buffer');

      const { normalizeExamplesBuild } = await import('../../scripts/normalize-examples-build.mjs');

      await expect(normalizeExamplesBuild(root)).rejects.toThrow(/destination already exists/i);
      expect(await readFile(resolve(dist, 'buffer/index.html'), 'utf8')).toBe('existing buffer');
      expect(await exists(resolve(dist, 'attribute-editing'))).toBe(false);
      expect(await exists(resolve(dist, 'examples/attribute-editing/index.html'))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rewrites public development routes to their physical HTML inputs', async () => {
    const configModule = await import('../../packages/examples/vite.config');
    const config = configModule.default as UserConfig;
    const routePlugin = (config.plugins as Plugin[]).find(
      (plugin) => plugin.name === 'examples-route-rewrite',
    );
    expect(routePlugin).toBeDefined();

    let middleware:
      | ((request: IncomingMessage, response: ServerResponse, next: () => void) => void)
      | undefined;
    if (typeof routePlugin?.configureServer !== 'function') {
      throw new Error('examples-route-rewrite must configure the Vite development server');
    }
    routePlugin.configureServer({
      middlewares: {
        use(handler: typeof middleware) {
          middleware = handler;
        },
      },
    } as never);
    if (!middleware) throw new Error('examples route middleware was not registered');

    const request = {
      url: '/emap/examples/getting-started/points/?source=dev',
    } as IncomingMessage;
    let nextCalls = 0;
    middleware(request, {} as ServerResponse, () => {
      nextCalls += 1;
    });

    expect(request.url).toBe('/examples/getting-started/points/index.html?source=dev');
    expect(nextCalls).toBe(1);
  });
});
