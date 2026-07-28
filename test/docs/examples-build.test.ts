// @vitest-environment node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, UserConfig } from 'vite';
import { describe, expect, it } from 'vitest';

const cdnFiles = {
  'mapshaper-vendor.js': 'vendor fixture\n',
  'emap.js': 'core fixture\n',
  'emap.css': 'css fixture\n',
} as const;

async function writeCdnFixture(root: string): Promise<string> {
  const distDir = resolve(root, 'dist');
  await mkdir(distDir, { recursive: true });
  await Promise.all(
    Object.entries(cdnFiles).map(([name, contents]) => writeFile(resolve(distDir, name), contents)),
  );
  return distDir;
}

function matchingCdnFetch(input: string | URL | Request): Promise<Response> {
  const fileName = new URL(String(input)).pathname.split('/').pop() as keyof typeof cdnFiles;
  const contents = cdnFiles[fileName];
  return Promise.resolve(
    contents === undefined ? new Response(null, { status: 404 }) : new Response(contents),
  );
}

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

describe('published examples CDN assets', () => {
  it('returns literal SHA-384 integrity after exact-version CDN bytes match local dist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-'));

    try {
      const distDir = await writeCdnFixture(root);
      const requestedUrls: string[] = [];
      const { verifyCdnAssets } = await import('../../scripts/check-example-cdn.mjs');

      const integrity = await verifyCdnAssets({
        version: '0.5.0',
        distDir,
        fetchImpl: async (input) => {
          requestedUrls.push(String(input));
          return matchingCdnFetch(input);
        },
      });

      expect(integrity).toEqual({
        vendor: 'sha384-QK9AUNMnVitdP9Hd+4l9gBiJy4R0AfquzWWzRx/wJU2I7t8HxMeknwmsWx41H3/C',
        core: 'sha384-Syn5ZnYZC3gWeR0Xar9iyUoJZMZoc4weHQL2joi6mBs4IDfTgkuAWEZSJXqAlnT0',
        css: 'sha384-UBMkxqeDcCTKPzPzjuIeBlUOJFn324DlNqSUk371f8IZnmXGcbPVocOx00EzeR8I',
      });
      expect(requestedUrls).toEqual([
        'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/mapshaper-vendor.js',
        'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.js',
        'https://cdn.jsdelivr.net/npm/@zwishing/emap@0.5.0/dist/emap.css',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    'latest',
    '^0.5.0',
    '0.5',
  ])('rejects non-exact version %s before fetching', async (version) => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-version-'));

    try {
      const distDir = await writeCdnFixture(root);
      const { verifyCdnAssets } = await import('../../scripts/check-example-cdn.mjs');

      await expect(
        verifyCdnAssets({
          version,
          distDir,
          fetchImpl: () => {
            throw new Error('network must not be reached for an invalid version');
          },
        }),
      ).rejects.toThrow(/exact package version/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects an unavailable CDN asset with its status and URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-404-'));

    try {
      const distDir = await writeCdnFixture(root);
      const { verifyCdnAssets } = await import('../../scripts/check-example-cdn.mjs');

      await expect(
        verifyCdnAssets({
          version: '0.5.0',
          distDir,
          fetchImpl: async (input) =>
            String(input).endsWith('/emap.js')
              ? new Response(null, { status: 404 })
              : matchingCdnFetch(input),
        }),
      ).rejects.toThrow(/emap\.js.*404/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects CDN bytes that differ from the local release asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-mismatch-'));

    try {
      const distDir = await writeCdnFixture(root);
      const { verifyCdnAssets } = await import('../../scripts/check-example-cdn.mjs');

      await expect(
        verifyCdnAssets({
          version: '0.5.0',
          distDir,
          fetchImpl: async (input) =>
            String(input).endsWith('/emap.css')
              ? new Response('different css\n')
              : matchingCdnFetch(input),
        }),
      ).rejects.toThrow(/emap\.css.*does not match/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a missing local release asset before fetching it from the CDN', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-missing-'));

    try {
      const distDir = await writeCdnFixture(root);
      await rm(resolve(distDir, 'emap.css'));
      const { verifyCdnAssets } = await import('../../scripts/check-example-cdn.mjs');

      await expect(
        verifyCdnAssets({ version: '0.5.0', distDir, fetchImpl: matchingCdnFetch }),
      ).rejects.toThrow(/missing local CDN comparison asset.*emap\.css/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('passes one verified integrity map into the CDN examples build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-build-'));
    const marker = resolve(root, 'spawn.json');

    try {
      await writeCdnFixture(root);
      await writeFile(resolve(root, 'package.json'), JSON.stringify({ version: '0.5.0' }));
      const { buildExamplesCdn } = await import('../../scripts/build-examples-cdn.mjs');

      await buildExamplesCdn({
        root,
        fetchImpl: matchingCdnFetch,
        spawnImpl(command, args, options) {
          writeFileSync(
            marker,
            JSON.stringify({
              command,
              args,
              mode: options.env.EMAP_EXAMPLES_ASSET_MODE,
              integrity: JSON.parse(options.env.EMAP_EXAMPLES_ASSET_INTEGRITY),
            }),
          );
          return { status: 0 };
        },
      });

      expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({
        command: 'pnpm',
        args: ['--filter', '@zwishing/emap-examples', 'build'],
        mode: 'cdn',
        integrity: {
          vendor: 'sha384-QK9AUNMnVitdP9Hd+4l9gBiJy4R0AfquzWWzRx/wJU2I7t8HxMeknwmsWx41H3/C',
          core: 'sha384-Syn5ZnYZC3gWeR0Xar9iyUoJZMZoc4weHQL2joi6mBs4IDfTgkuAWEZSJXqAlnT0',
          css: 'sha384-UBMkxqeDcCTKPzPzjuIeBlUOJFn324DlNqSUk371f8IZnmXGcbPVocOx00EzeR8I',
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not start the examples build when CDN verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-gate-'));
    const marker = resolve(root, 'spawned');

    try {
      await writeCdnFixture(root);
      await writeFile(resolve(root, 'package.json'), JSON.stringify({ version: '0.5.0' }));
      const { buildExamplesCdn } = await import('../../scripts/build-examples-cdn.mjs');

      await expect(
        buildExamplesCdn({
          root,
          fetchImpl: async (input) =>
            String(input).endsWith('/emap.js')
              ? new Response('untrusted core\n')
              : matchingCdnFetch(input),
          spawnImpl() {
            writeFileSync(marker, 'started');
            return { status: 0 };
          },
        }),
      ).rejects.toThrow(/emap\.js.*does not match/i);
      await expect(access(marker)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a failed examples child build with its exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-example-cdn-child-failure-'));

    try {
      await writeCdnFixture(root);
      await writeFile(resolve(root, 'package.json'), JSON.stringify({ version: '0.5.0' }));
      const { buildExamplesCdn } = await import('../../scripts/build-examples-cdn.mjs');

      await expect(
        buildExamplesCdn({
          root,
          fetchImpl: matchingCdnFetch,
          spawnImpl() {
            return { status: 23 };
          },
        }),
      ).rejects.toThrow(/examples build failed with exit code 23/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('exposes explicit CDN build scripts while keeping the default build local', async () => {
    const rootManifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    const examplesManifest = JSON.parse(
      await readFile(resolve(process.cwd(), 'packages/examples/package.json'), 'utf8'),
    );

    expect(rootManifest.scripts['examples:build']).toBe(
      'pnpm --filter @zwishing/emap-examples build',
    );
    expect(rootManifest.scripts['examples:build:cdn']).toBe('node scripts/build-examples-cdn.mjs');
    expect(examplesManifest.scripts.build).toBe(
      'vite build && node ../../scripts/normalize-examples-build.mjs',
    );
    expect(examplesManifest.scripts['build:cdn']).toBe('node ../../scripts/build-examples-cdn.mjs');
  });
});
