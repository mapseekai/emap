import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DOC_IDS = ['intro', 'getting-started/installation', 'concepts/overview'] as const;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function frontMatter(markdown: string): Record<string, string> {
  const match = /^---\n(?<body>[\s\S]*?)\n---/.exec(markdown);
  expect(match?.groups?.body).toBeDefined();

  return Object.fromEntries(
    match?.groups?.body
      .split('\n')
      .map((line) => line.match(/^(?<key>[\w-]+):\s*(?<value>.+)$/))
      .filter(
        (lineMatch): lineMatch is RegExpMatchArray & { groups: { key: string; value: string } } =>
          Boolean(lineMatch?.groups),
      )
      .map((lineMatch) => [lineMatch.groups.key, lineMatch.groups.value]) ?? [],
  );
}

describe('Docusaurus i18n layout', () => {
  it('declares zh-CN as the default locale and en as the alternate locale', async () => {
    const configPath = resolve(process.cwd(), 'packages/docs/docusaurus.config.ts');
    const config = await readFile(configPath, 'utf8');

    expect(config).toContain("defaultLocale: 'zh-CN'");
    expect(config).toContain("locales: ['zh-CN', 'en']");
  });

  it('mirrors every Chinese seed document in the English Docusaurus i18n path', async () => {
    for (const docId of DOC_IDS) {
      const sourcePath = resolve(process.cwd(), 'packages/docs/docs', `${docId}.md`);
      const englishPath = resolve(
        process.cwd(),
        'packages/docs/i18n/en/docusaurus-plugin-content-docs/current',
        `${docId}.md`,
      );

      expect(await fileExists(sourcePath), `${sourcePath} should exist`).toBe(true);
      expect(await fileExists(englishPath), `${englishPath} should exist`).toBe(true);

      const sourceFrontMatter = frontMatter(await readFile(sourcePath, 'utf8'));
      const englishFrontMatter = frontMatter(await readFile(englishPath, 'utf8'));

      expect(englishFrontMatter.id).toBe(sourceFrontMatter.id);
      expect(englishFrontMatter.slug).toBe(sourceFrontMatter.slug);
    }
  });
});
