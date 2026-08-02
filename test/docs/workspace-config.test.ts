import { access, readFile } from 'node:fs/promises';
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

  it('uses the examples public SVG as the only project brand asset source', async () => {
    const config = (await import('../../packages/docs/docusaurus.config')).default;
    const navbar = (
      config.themeConfig as {
        navbar?: { logo?: { src?: string; srcDark?: string } };
      }
    )?.navbar;
    const [readme, readmeZh, icon] = await Promise.all([
      readFile(resolve(process.cwd(), 'README.md'), 'utf8'),
      readFile(resolve(process.cwd(), 'README.zh-CN.md'), 'utf8'),
      readFile(resolve(process.cwd(), 'packages/examples/public/emap.svg'), 'utf8'),
    ]);

    expect(config.favicon).toBe('/mapseekai/emap/examples/emap.svg');
    expect(navbar?.logo?.src).toBe('/mapseekai/emap/examples/emap.svg');
    expect(navbar?.logo?.srcDark).toBe('/mapseekai/emap/examples/emap.svg');
    expect(readme).toContain('packages/examples/public/emap.svg');
    expect(readmeZh).toContain('packages/examples/public/emap.svg');
    expect(icon).toMatch(/^<svg\b/);
    await expect(
      access(resolve(process.cwd(), 'packages/docs/static/img/emap.svg')),
    ).rejects.toThrow();
  });
});
