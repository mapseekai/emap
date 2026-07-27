import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
});
