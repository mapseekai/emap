import { readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';

/** Check local TypeDoc links against generated pages, not reflection names alone. */
export async function collectApiLinkViolations(root, docs) {
  const apiRoot = resolve(root, 'packages/docs/static/api');
  const pages = new Map();
  const violations = [];

  for (const doc of docs) {
    const markdown = await readFile(doc.path, 'utf8');
    // Keep newlines for diagnostics while ignoring examples inside code fences.
    const text = markdown
      .replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2[^\n]*/g, (code) =>
        code.replace(/[^\n]/g, ' '),
      )
      .replace(/`+[^`\n]*`+/g, (code) => ' '.repeat(code.length));
    const links = /\]\(\s*<?([^\s)>]+)>?|\bhref=["']([^"']+)["']|^\s*\[[^\]]+\]:\s*<?([^\s>]+)>?|<(\/[^\s>]+)>/gm;
    for (const match of text.matchAll(links)) {
      const target = match[1] ?? match[2] ?? match[3] ?? match[4];
      const url = new URL(target, 'https://emap.invalid/');
      if (url.origin !== 'https://emap.invalid') continue;
      const apiPath = url.pathname.match(/\/api\/(.*)$/)?.[1];
      if (apiPath === undefined) continue;
      const location = `${relative(root, doc.path).replaceAll('\\', '/')}:${text.slice(0, match.index).split('\n').length}`;
      let file;
      let anchor;
      try {
        file = resolve(apiRoot, decodeURIComponent(apiPath) || 'index.html');
        anchor = decodeURIComponent(url.hash.slice(1));
      } catch {
        violations.push({ path: location, reason: `invalid API link encoding: ${target}` });
        continue;
      }
      if (!file.startsWith(`${apiRoot}${sep}`)) {
        violations.push({ path: location, reason: `API link escapes generated directory: ${target}` });
        continue;
      }
      if (!pages.has(file)) {
        try {
          const html = await readFile(file, 'utf8');
          pages.set(file, new Set([...html.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map((m) => m[1])));
        } catch (error) {
          if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
          pages.set(file, null);
        }
      }
      const anchors = pages.get(file);
      if (anchors === null) {
        violations.push({ path: location, reason: `missing generated API page: ${target}` });
      } else if (anchor && !anchors.has(anchor)) {
        violations.push({ path: location, reason: `missing generated API anchor: ${target}` });
      }
    }
  }
  return violations;
}
