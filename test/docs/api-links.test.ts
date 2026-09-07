import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectApiLinkViolations } from '../../scripts/check-api-links.mjs';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(markdown: string, locale = 'zh') {
  const root = await mkdtemp(join(tmpdir(), 'emap-api-links-'));
  roots.push(root);
  const path = join(
    root,
    locale === 'zh'
      ? 'packages/docs/docs/example.md'
      : 'packages/docs/i18n/en/docusaurus-plugin-content-docs/current/example.md',
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown);
  const page = join(root, 'packages/docs/static/api/types/emap.LayerSpecification.html');
  await mkdir(dirname(page), { recursive: true });
  await writeFile(page, '<h1 id="layer">Layer</h1>');
  return collectApiLinkViolations(root, [{ path }]);
}

describe('generated API links', () => {
  it.each(['zh', 'en'])('rejects stale interface links in %s documentation', async (locale) => {
    const result = await fixture(
      '[Layer](/mapseekai/emap/api/interfaces/emap.LayerSpecification.html)',
      locale,
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('missing generated API page');
    expect(result[0].path).toContain('example.md:1');
  });

  it('validates anchors and reports the source line', async () => {
    const result = await fixture(
      '# Intro\n\n[Layer](/mapseekai/emap/api/types/emap.LayerSpecification.html#missing)',
    );
    expect(result).toHaveLength(1);
    expect(result[0].reason).toContain('missing generated API anchor');
    expect(result[0].path).toContain('example.md:3');
  });

  it('accepts generated pages and anchors, including encoded anchors', async () => {
    expect(
      await fixture('[Layer](/mapseekai/emap/api/types/emap.LayerSpecification.html#%6Cayer)'),
    ).toEqual([]);
  });

  it('checks reference-style and HTML links too', async () => {
    const result = await fixture(
      '[Layer][ref]\n[ref]: /mapseekai/emap/api/types/missing.html\n<a href="/mapseekai/emap/api/classes/missing.html">Missing</a>',
    );
    expect(result).toHaveLength(2);
  });

  it('ignores external links and code examples', async () => {
    expect(
      await fixture(
        '[External](https://example.com/api/missing.html)\n```md\n[Example](/mapseekai/emap/api/missing.html)\n```\n`[Inline](/mapseekai/emap/api/missing.html)`',
      ),
    ).toEqual([]);
  });
});
