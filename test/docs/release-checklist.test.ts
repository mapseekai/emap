import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PreviewResponse {
  statusCode: number;
  setHeader(name: string, value: string | number | readonly string[]): void;
  end(chunk?: string | Uint8Array): void;
}

type PreviewHandler = (
  request: { method?: string; url?: string },
  response: PreviewResponse,
) => void | Promise<void>;

async function loadPreviewModule() {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'scripts/preview-docs.mjs')).href;
  return import(/* @vite-ignore */ moduleUrl).catch(() => null);
}

async function requestPreview(handler: PreviewHandler, url: string) {
  const headers = new Map<string, string>();
  const chunks: Buffer[] = [];
  let finish: (result: { status: number; headers: Map<string, string>; body: Buffer }) => void;
  const completed = new Promise<{ status: number; headers: Map<string, string>; body: Buffer }>(
    (resolveRequest) => {
      finish = resolveRequest;
    },
  );
  const response: PreviewResponse = {
    statusCode: 200,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), String(value));
    },
    end(chunk) {
      if (chunk !== undefined) chunks.push(Buffer.from(chunk));
      finish({ status: response.statusCode, headers, body: Buffer.concat(chunks) });
    },
  };

  await handler({ method: 'GET', url }, response);
  return completed;
}

describe('release documentation checklist', () => {
  it('lists every required release verification gate', async () => {
    const checklist = await readFile(resolve(process.cwd(), 'docs/release-checklist.md'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const gates = [
      'format:check',
      'typecheck',
      'test:run',
      'build',
      'test:duckdb',
      'api:build',
      'examples:build',
      'docs:build',
      'docs:compose-examples',
      'docs:check-i18n',
      'docs:check-api',
      'examples:check',
    ];

    for (const gate of gates) {
      expect(checklist).toContain(gate);
      expect(manifest.scripts?.[gate]).toEqual(expect.any(String));
    }

    const docsVerify = manifest.scripts?.['docs:verify'] ?? '';
    for (const gate of [
      'typecheck',
      'api:build',
      'examples:build',
      'docs:build',
      'docs:compose-examples',
      'docs:check-i18n',
      'docs:check-api',
      'examples:check',
    ]) {
      expect(docsVerify).toContain(gate);
    }
  });

  it('documents examples at the public Docusaurus path', async () => {
    const checklist = await readFile(resolve(process.cwd(), 'docs/release-checklist.md'), 'utf8');

    expect(checklist).toContain('packages/docs/build/examples/index.html');
    expect(checklist).toContain('/examples/');
  });

  it('defines one local preview command that builds and serves the composed docs site', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const previewSteps = (manifest.scripts?.['docs:preview'] ?? '')
      .split('&&')
      .map((step) => step.trim());

    expect(previewSteps).toEqual([
      'pnpm run build',
      'pnpm run api:build',
      'pnpm run examples:build',
      'pnpm run docs:build',
      'pnpm run docs:compose-examples',
      'node scripts/preview-docs.mjs',
    ]);
  });

  it('documents one-origin local preview without a second examples port', async () => {
    const checklist = await readFile(resolve(process.cwd(), 'docs/release-checklist.md'), 'utf8');

    expect(checklist).toContain('pnpm run docs:preview');
    expect(checklist).toContain('single process and port');
    expect(checklist).not.toContain('@zwishing/emap-examples preview');
  });

  it('serves docs, example routes, and static assets from the composed build', async () => {
    const previewModule = await loadPreviewModule();
    expect(
      previewModule,
      'scripts/preview-docs.mjs must export createDocsPreviewHandler',
    ).not.toBeNull();
    if (!previewModule) return;

    const root = await mkdtemp(join(tmpdir(), 'emap-docs-preview-'));

    try {
      const build = resolve(root, 'packages/docs/build');
      await mkdir(resolve(build, 'examples/buffer'), { recursive: true });
      await mkdir(resolve(build, 'examples/fixtures'), { recursive: true });
      await mkdir(resolve(build, 'examples/vendor'), { recursive: true });
      await mkdir(resolve(build, 'assets'), { recursive: true });
      await writeFile(resolve(build, 'index.html'), '<!doctype html><title>docs</title>');
      await writeFile(
        resolve(build, 'examples/buffer/index.html'),
        '<!doctype html><title>buffer</title>',
      );
      await writeFile(resolve(build, 'assets/site.css'), 'body { color: navy; }');
      await writeFile(resolve(build, 'examples/vendor/emap.js'), 'globalThis.emap = {};');
      await writeFile(resolve(build, 'examples/fixtures/starter.geojson'), '{"type":"Point"}');
      await writeFile(resolve(build, 'examples/fixtures/starter.parquet'), 'PAR1fixture');
      await writeFile(resolve(build, 'examples/emap-worker.js'), 'self.postMessage("ready");');

      const handler = previewModule.createDocsPreviewHandler({ root }) as PreviewHandler;
      const docs = await requestPreview(handler, '/emap/');
      const example = await requestPreview(handler, '/emap/examples/buffer/');
      const spa = await requestPreview(handler, '/emap/concepts/not-generated/');
      const css = await requestPreview(handler, '/emap/assets/site.css');
      const vendor = await requestPreview(handler, '/emap/examples/vendor/emap.js');
      const fixture = await requestPreview(handler, '/emap/examples/fixtures/starter.geojson');
      const parquet = await requestPreview(handler, '/emap/examples/fixtures/starter.parquet');
      const worker = await requestPreview(handler, '/emap/examples/emap-worker.js');
      const missingAsset = await requestPreview(handler, '/emap/assets/missing.js');

      expect(docs).toMatchObject({ status: 200 });
      expect(docs.body.toString()).toContain('<title>docs</title>');
      expect(example).toMatchObject({ status: 200 });
      expect(example.body.toString()).toContain('<title>buffer</title>');
      expect(spa.body.toString()).toContain('<title>docs</title>');
      expect(css.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(vendor.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(fixture.headers.get('content-type')).toBe('application/geo+json; charset=utf-8');
      expect(parquet.headers.get('content-type')).toBe('application/octet-stream');
      expect(worker.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(missingAsset.status).toBe(404);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    '/emap/../package.json',
    '/emap/%2e%2e/package.json',
    '/emap/..%2Fpackage.json',
    '/emap/%5c..%5cpackage.json',
  ])('rejects preview path traversal: %s', async (url) => {
    const previewModule = await loadPreviewModule();
    expect(
      previewModule,
      'scripts/preview-docs.mjs must export createDocsPreviewHandler',
    ).not.toBeNull();
    if (!previewModule) return;

    const root = await mkdtemp(join(tmpdir(), 'emap-docs-preview-traversal-'));

    try {
      await mkdir(resolve(root, 'packages/docs/build'), { recursive: true });
      await writeFile(resolve(root, 'packages/docs/build/index.html'), '<!doctype html>');
      await writeFile(resolve(root, 'package.json'), '{"private":true}');

      const handler = previewModule.createDocsPreviewHandler({ root }) as PreviewHandler;
      const response = await requestPreview(handler, url);

      expect(response.status).toBe(403);
      expect(response.body.toString()).not.toContain('private');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('composes examples with public docs links and a public worker asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-docs-release-'));

    try {
      await mkdir(resolve(root, 'packages/examples/dist/assets'), { recursive: true });
      await mkdir(resolve(root, 'packages/examples/dist/buffer'), { recursive: true });
      await mkdir(resolve(root, 'packages/docs/build'), { recursive: true });

      await writeFile(resolve(root, 'packages/examples/dist/index.html'), '<!doctype html>');
      await writeFile(resolve(root, 'packages/examples/dist/buffer/index.html'), '<!doctype html>');
      await writeFile(resolve(root, 'packages/docs/build/index.html'), '<!doctype html>');
      await writeFile(
        resolve(root, 'packages/examples/dist/emap-worker.js'),
        'self.postMessage("ready");',
      );
      await writeFile(
        resolve(root, 'packages/examples/dist/assets/main.js'),
        [
          'const returnToDocs = "/emap/concepts/emap/";',
          'const workerUrl = "/emap/examples/emap-worker.js";',
        ].join('\n'),
      );

      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), 'scripts/compose-docs-release.mjs'), '--root', root],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);

      const composedMain = await readFile(
        resolve(root, 'packages/docs/build/examples/assets/main.js'),
        'utf8',
      );
      const composedWorker = await readFile(
        resolve(root, 'packages/docs/build/examples/emap-worker.js'),
        'utf8',
      );
      const composedBuffer = await readFile(
        resolve(root, 'packages/docs/build/examples/buffer/index.html'),
        'utf8',
      );

      expect(composedMain).toContain('/emap/concepts/emap/');
      expect(composedMain).not.toContain('/docs/');
      expect(composedMain).toContain('/emap/examples/emap-worker.js');
      expect(composedMain).not.toContain('/dist/emap-worker.js');
      expect(composedWorker).toBe('self.postMessage("ready");');
      expect(composedBuffer).toBe('<!doctype html>');
      await expect(
        access(resolve(root, 'packages/docs/build/examples/examples')),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a nested examples directory instead of publishing a doubled route', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-docs-nested-examples-'));

    try {
      await mkdir(resolve(root, 'packages/examples/dist/assets'), { recursive: true });
      await mkdir(resolve(root, 'packages/examples/dist/buffer'), { recursive: true });
      await mkdir(resolve(root, 'packages/examples/dist/examples/stale'), { recursive: true });
      await mkdir(resolve(root, 'packages/docs/build'), { recursive: true });
      await writeFile(resolve(root, 'packages/examples/dist/index.html'), '<!doctype html>');
      await writeFile(resolve(root, 'packages/examples/dist/buffer/index.html'), 'buffer');
      await writeFile(resolve(root, 'packages/examples/dist/examples/stale/index.html'), 'stale');
      await writeFile(resolve(root, 'packages/examples/dist/assets/main.js'), 'export {};');
      await writeFile(resolve(root, 'packages/docs/build/index.html'), '<!doctype html>');
      await writeFile(
        resolve(root, 'packages/examples/dist/emap-worker.js'),
        'self.postMessage("ready");',
      );

      const result = spawnSync(
        process.execPath,
        [resolve(process.cwd(), 'scripts/compose-docs-release.mjs'), '--root', root],
        { cwd: process.cwd(), encoding: 'utf8' },
      );

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/nested examples directory/i);
      await expect(
        access(resolve(root, 'packages/docs/build/examples/examples')),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
