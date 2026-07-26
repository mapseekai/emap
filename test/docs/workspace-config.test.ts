import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('documentation workspace config', () => {
  it('defines documentation and examples root scripts', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };

    const scriptNames = [
      'docs:build',
      'api:build',
      'examples:build',
      'docs:check-i18n',
      'docs:check-api',
      'examples:check',
      'docs:verify',
    ];

    for (const scriptName of scriptNames) {
      expect(manifest.scripts?.[scriptName]).toEqual(expect.any(String));
    }
  });
});
