import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('documentation workspace config', () => {
  it('defines documentation and examples root scripts', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };

    const scriptNames = [
      'docs:clean',
      'docs:dev',
      'docs:build',
      'api:build',
      'examples:build',
      'docs:compose-examples',
      'docs:check-i18n',
      'docs:check-api',
      'examples:check',
      'docs:verify',
    ];

    for (const scriptName of scriptNames) {
      expect(manifest.scripts?.[scriptName]).toEqual(expect.any(String));
    }
  });

  it('clears Docusaurus generated metadata before local docs startup', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
    };

    expect(manifest.scripts?.['docs:clean']).toBe(
      "node -e \"require('node:fs').rmSync('packages/docs/.docusaurus',{recursive:true,force:true})\"",
    );
    expect(manifest.scripts?.['docs:dev']).toBe(
      'pnpm run docs:clean && pnpm --filter @mapseekai/emap-docs start',
    );
  });
});
