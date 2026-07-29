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
const examplesBaseUrl = '/mapseekai/emap/examples/';

function examplesBrandPlugin(): Plugin {
  const logoUrl = `${examplesBaseUrl}emap.svg`;

  return {
    name: 'examples-brand',
    transformIndexHtml: {
      order: 'pre',
      handler: () => [
        {
          tag: 'link',
          attrs: { rel: 'icon', type: 'image/svg+xml', href: logoUrl },
          injectTo: 'head',
        },
        {
          tag: 'style',
          children: `
            :root {
              --emap-banner-bg: #2c3e50;
              --emap-banner-ink: #ffffff;
            }

            #header {
              position: relative;
              box-sizing: border-box;
              min-height: 48px;
              padding-right: 330px !important;
              background: var(--emap-banner-bg) !important;
              color: var(--emap-banner-ink) !important;
              border-bottom: 1px solid #1f2d3a;
            }

            .emap-example-banner-brand {
              display: inline-flex;
              align-items: center;
              flex: 0 0 auto;
              gap: 6px;
              color: inherit;
              font: 700 14px/1 ui-sans-serif, system-ui, sans-serif;
              text-decoration: none;
            }

            .emap-example-banner-brand:hover {
              color: #b8e0c1;
            }

            .emap-example-banner-brand:focus-visible {
              outline: 2px solid #8acb99;
              outline-offset: 2px;
            }

            .emap-example-banner-brand img {
              width: 18px;
              height: 18px;
              display: block;
            }

            .emap-example-map-tools {
              position: absolute;
              z-index: 2;
              top: 10px;
              right: 14px;
              display: inline-flex;
              align-items: center;
              gap: 10px;
              order: 999;
              margin-left: 0;
              color: var(--emap-banner-ink);
              font: 12px/1.2 ui-sans-serif, system-ui, sans-serif;
              white-space: nowrap;
            }

            .emap-example-crs-field {
              display: inline-flex;
              align-items: center;
              gap: 6px;
            }

            .emap-example-crs-select {
              min-height: 28px;
              padding: 3px 26px 3px 8px;
              border: 1px solid #64788c;
              border-radius: 4px;
              background: #1f2d3a;
              color: #ffffff;
              font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
            }

            .emap-example-crs-select:focus-visible {
              outline: 2px solid #8acb99;
              outline-offset: 2px;
            }

            .emap-example-basemap-state {
              color: #cbd5df;
            }

            body.emap-example-with-floating-header {
              box-sizing: border-box;
              height: 100vh;
              padding-top: 48px;
            }

            body.emap-example-with-floating-header > #header {
              position: fixed;
              z-index: 30;
              top: 0;
              right: 0;
              left: 0;
              box-sizing: border-box;
              min-height: 48px;
              padding: 10px 14px;
              display: flex;
              align-items: center;
              gap: 10px;
            }

            body.emap-example-with-floating-header > #map {
              width: 100%;
              height: 100%;
            }

            body.emap-example-with-floating-header > .panel {
              top: 60px;
              max-height: calc(100vh - 72px);
              overflow: auto;
              box-sizing: border-box;
            }

            @media (max-width: 720px) {
              #header {
                padding-right: 10px !important;
              }

              .emap-example-map-tools {
                position: static;
                margin-left: auto;
              }

              .emap-example-basemap-state {
                display: none;
              }
            }
          `,
          injectTo: 'head',
        },
      ],
    },
  };
}

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
        const publicPrefix = '/mapseekai/emap/examples/';
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
  base: '/mapseekai/emap/examples/',
  resolve: {
    alias: [
      {
        find: 'mapshaper',
        replacement: fileURLToPath(new URL('./src/mapshaper-global.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/arrow',
        replacement: fileURLToPath(new URL('../../src/arrow/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/duckdb',
        replacement: fileURLToPath(new URL('../../src/duckdb/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/style.css',
        replacement: fileURLToPath(new URL('../../src/ui/controls.css', import.meta.url)),
      },
      {
        find: '@mapseekai/emap',
        replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      },
    ],
  },
  define: {
    __EMAP_ASSET_INTEGRITY__: JSON.stringify(assetIntegrity),
    __EMAP_ASSET_MODE__: JSON.stringify(assetMode),
    __EMAP_VERSION__: JSON.stringify(version),
  },
  plugins: [examplesBrandPlugin(), examplesRouteRewritePlugin(), runtimeAssetsPlugin()],
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
