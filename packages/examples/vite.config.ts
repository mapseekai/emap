import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { runtimeAssetsPlugin } from './build/runtime-assets-plugin';

const { version } = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const assetMode = process.env.EMAP_EXAMPLES_ASSET_MODE ?? 'local';
if (assetMode !== 'local' && assetMode !== 'cdn') {
  throw new Error(`Unsupported EMAP_EXAMPLES_ASSET_MODE: ${assetMode}`);
}
const assetIntegrity = JSON.parse(process.env.EMAP_EXAMPLES_ASSET_INTEGRITY ?? '{}') as unknown;

const routeIds = [
  'getting-started/geojson-viewer',
  'getting-started/points',
  'getting-started/lines',
  'getting-started/polygons',
  'getting-started/polygon-fill',
  'attribute-editing',
  'attribute-expressions',
  'data-engineering',
  'feature-attributes',
  'filter-features',
  'geoparquet-viewer',
  'export-geoparquet',
  'export-roundtrip',
  'join',
  'merge-layers',
  'merge-selected',
  'rename-layer',
  'split-layer',
  'interaction-handlers',
  'feature-selection',
  'box-select',
  'lasso-select',
  'china-editing',
  'draw-snap-clear',
  'draw-snap-edge',
  'feature-rotate-scale',
  'feature-translate',
  'snapshot',
  'transaction',
  'undo-redo',
  'vertex-editing',
  'buffer',
  'check-geometry',
  'clip-erase',
  'dissolve',
  'divide',
  'explode',
  'innerlines',
  'mosaic',
  'project',
  'rebuild-topology',
  'simplify-control',
  'simplify',
  'snap-layer',
  'union',
  'crs-switch',
  'web-worker',
  'duckdb-buffer',
  'duckdb-geoparquet-query',
  'duckdb-overlay',
  'duckdb-query',
  'duckdb-spatial-ops',
] as const;

const htmlInput = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const routeIdSet = new Set<string>(routeIds);

function examplesRouteRewritePlugin(): Plugin {
  return {
    name: 'examples-route-rewrite',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = request.url;
        if (!url) return next();
        const queryIndex = url.indexOf('?');
        const pathname = queryIndex === -1 ? url : url.slice(0, queryIndex);
        const query = queryIndex === -1 ? '' : url.slice(queryIndex);
        const publicPrefix = '/emap/examples/';
        if (pathname.startsWith(publicPrefix) && pathname.endsWith('/')) {
          const routeId = pathname.slice(publicPrefix.length, -1);
          if (routeIdSet.has(routeId)) {
            request.url = `/examples/${routeId}/index.html${query}`;
          }
        }
        next();
      });
    },
  };
}

export default defineConfig({
  base: '/emap/examples/',
  define: {
    __EMAP_ASSET_INTEGRITY__: JSON.stringify(assetIntegrity),
    __EMAP_ASSET_MODE__: JSON.stringify(assetMode),
    __EMAP_VERSION__: JSON.stringify(version),
  },
  plugins: [examplesRouteRewritePlugin(), runtimeAssetsPlugin()],
  build: {
    chunkSizeWarningLimit: 2500,
    emptyOutDir: true,
    outDir: 'dist',
    rollupOptions: {
      input: {
        index: htmlInput('./index.html'),
        ...Object.fromEntries(
          routeIds.map((id) => [`examples/${id}/index`, htmlInput(`./examples/${id}/index.html`)]),
        ),
      },
    },
  },
});
