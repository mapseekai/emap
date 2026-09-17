import type { Plugin } from 'vite';

const guardedBuiltins = new Set(['fs', 'http', 'path', 'crypto']);
const virtualPrefix = '\0emap-browser-upstream-builtin:';

function isGuardedUpstream(importer: string): boolean {
  const path = importer.replaceAll('\\', '/');
  return (
    path.includes('/@ngageoint/geopackage/dist/lib/db/sqljsAdapter.js') ||
    path.includes('/rtree-sql.js/dist/sql-wasm.js')
  );
}

function unavailable(name: string, members: readonly string[]): string {
  const message = JSON.stringify(
    `${name} is a Node-only fallback and must not execute in the emap browser GeoPackage path`,
  );
  const exports = members.map((member) => `export const ${member} = fail;`).join('\n');
  const properties = members.join(', ');
  return `const fail = () => { throw new Error(${message}); };\n${exports}\nexport default { ${properties} };\n`;
}

/**
 * The upstream SQL.js wrappers contain dead Node branches next to their browser
 * implementation. Resolve only those branch-local builtins so Vite does not
 * externalize them into browser code or require broad Node polyfills.
 */
export function upstreamBrowserBuiltinsPlugin(): Plugin {
  return {
    name: 'emap-upstream-browser-builtins',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !guardedBuiltins.has(source) || !isGuardedUpstream(importer)) return null;
      return `${virtualPrefix}${source}`;
    },
    load(id) {
      if (!id.startsWith(virtualPrefix)) return null;
      const name = id.slice(virtualPrefix.length);
      if (name === 'fs') return unavailable(name, ['readFile', 'readFileSync', 'statSync']);
      if (name === 'http') return unavailable(name, ['get']);
      if (name === 'path') return unavailable(name, ['dirname', 'normalize']);
      if (name === 'crypto') return unavailable(name, ['randomBytes']);
      return null;
    },
  };
}
