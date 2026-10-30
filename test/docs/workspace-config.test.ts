import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('engine compatibility baseline', () => {
  it('declares the Node and evergreen-browser compatibility baseline', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      engines?: { node?: string };
      browserslist?: string[];
    };
    const rollup = await readFile(resolve(process.cwd(), 'rollup.config.mjs'), 'utf8');

    expect(manifest.engines?.node).toBe('>=22.18 <25');
    expect(manifest.browserslist).toEqual([
      'Chrome >= 109',
      'Edge >= 109',
      'Firefox >= 115',
      'Safari >= 16.4',
    ]);
    expect(rollup).toContain("const browserSyntaxTarget = 'es2022';");
    expect(rollup).toContain('target: browserSyntaxTarget');
  });
});
