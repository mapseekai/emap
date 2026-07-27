import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('composes examples with public docs links and a public worker asset', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emap-docs-release-'));

    try {
      await mkdir(resolve(root, 'packages/examples/dist/assets'), { recursive: true });
      await mkdir(resolve(root, 'packages/examples/dist/examples/buffer'), { recursive: true });
      await mkdir(resolve(root, 'packages/docs/build'), { recursive: true });
      await mkdir(resolve(root, 'dist'), { recursive: true });

      await writeFile(resolve(root, 'packages/examples/dist/index.html'), '<!doctype html>');
      await writeFile(
        resolve(root, 'packages/examples/dist/examples/buffer/index.html'),
        '<!doctype html>',
      );
      await writeFile(resolve(root, 'packages/docs/build/index.html'), '<!doctype html>');
      await writeFile(resolve(root, 'dist/emap-worker.js'), 'self.postMessage("ready");');
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

      expect(composedMain).toContain('/emap/concepts/emap/');
      expect(composedMain).not.toContain('/docs/');
      expect(composedMain).toContain('/emap/examples/emap-worker.js');
      expect(composedMain).not.toContain('/dist/emap-worker.js');
      expect(composedWorker).toBe('self.postMessage("ready");');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
