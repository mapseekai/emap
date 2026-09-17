import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { upstreamBrowserBuiltinsPlugin } from '../../packages/examples/build/upstream-browser-builtins-plugin';

const root = process.cwd();

describe('examples browser build boundaries', () => {
  it('guards Node-only branches only for upstream GeoPackage SQL.js wrappers', async () => {
    const plugin = upstreamBrowserBuiltinsPlugin();
    const resolveId = plugin.resolveId as any;
    const load = plugin.load as any;
    const adapter = '/repo/node_modules/@ngageoint/geopackage/dist/lib/db/sqljsAdapter.js';
    const sqlWasm = '/repo/node_modules/rtree-sql.js/dist/sql-wasm.js';

    expect(String(await resolveId.call({}, 'fs', adapter))).toContain(
      'browser-upstream-builtin:fs',
    );
    expect(String(await resolveId.call({}, 'crypto', sqlWasm))).toContain(
      'browser-upstream-builtin:crypto',
    );
    expect(await resolveId.call({}, 'fs', '/repo/src/application.ts')).toBeNull();
    const shim = await load.call({}, String(await resolveId.call({}, 'path', sqlWasm)));
    expect(shim).toContain('Node-only fallback');
    expect(shim).not.toMatch(/node:(?:fs|http|path|crypto)/);
  });
  it('has no unresolved root stylesheet references in authored examples', () => {
    for (const relative of [
      'packages/examples/examples/export-formats/index.html',
      'packages/examples/examples/getting-started/topojson-viewer/index.html',
      'packages/examples/examples/getting-started/kml-viewer/index.html',
    ]) {
      expect(readFileSync(resolve(root, relative), 'utf8')).not.toContain('href="/style.css"');
    }
  });

  it('marks the packaged sibling GeoTIFF worker as an intentional runtime URL', () => {
    const source = readFileSync(resolve(root, 'src/integrations/geotiff/source.ts'), 'utf8');
    expect(source).toContain(
      "new URL(/* @vite-ignore */ './emap-geotiff-worker.js', import.meta.url)",
    );
  });
});
