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
  'getting-started/shapefile-viewer',
  'getting-started/points',
  'getting-started/point-style',
  'getting-started/lines',
  'getting-started/polygons',
  'getting-started/polygon-fill',
  'attribute-editing',
  'attribute-expressions',
  'data-engineering',
  'feature-attributes',
  'filter-features',
  'geoparquet-viewer',
  'flatgeobuf-viewer',
  'export-geoparquet',
  'export-roundtrip',
  'join',
  'merge-layers',
  'merge-selected',
  'rename-layer',
  'split-layer',
  'interaction-handlers',
  'measurement',
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
  'online-map-services',
  'web-worker',
  'duckdb-buffer',
  'duckdb-geoparquet-query',
  'duckdb-overlay',
  'duckdb-query',
  'duckdb-spatial-aggregate-join',
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
      handler: (html) => [
        {
          tag: 'link',
          attrs: { rel: 'icon', type: 'image/svg+xml', href: logoUrl },
          injectTo: 'head',
        },
        {
          tag: 'style',
          children: `
            :root {
              --emap-banner-bg: oklch(1 0 0);
              --emap-banner-ink: oklch(0.25 0.01 149);
              --emap-example-background: oklch(0.99 0.002 149);
              --emap-example-muted: oklch(0.97 0.002 149);
              --emap-example-muted-foreground: oklch(0.5 0.02 149);
              --emap-example-accent: oklch(0.96 0.01 149);
              --emap-example-input: oklch(0.94 0.005 149);
              --emap-example-border: oklch(0.92 0.005 149);
              --emap-example-border-strong: oklch(0.85 0.008 149);
              --emap-example-primary: oklch(0.627 0.194 149);
              --emap-example-primary-foreground: oklch(1 0 0);
              --emap-example-selection: oklch(0.95 0.03 149);
              --emap-example-error: oklch(0.6 0.18 25);
              --emap-example-info: oklch(0.623 0.17 245);
              --emap-example-font: "Geist Mono Variable", ui-monospace, "SF Mono", Menlo, monospace;
            }

            #header {
              position: relative;
              box-sizing: border-box;
              min-height: 48px;
              padding-right: 410px !important;
              background: var(--emap-banner-bg) !important;
              color: var(--emap-banner-ink) !important;
              border-bottom: 1px solid var(--emap-example-border) !important;
              box-shadow: none;
            }

            .emap-example-banner-brand {
              display: inline-flex;
              align-items: center;
              flex: 0 0 auto;
              gap: 6px;
              color: inherit;
              font: 600 13px/1.3333 var(--emap-example-font);
              text-decoration: none;
            }

            .emap-example-banner-brand:hover {
              color: var(--emap-example-primary);
            }

            .emap-example-banner-brand:focus-visible {
              outline: 3px solid color-mix(in oklch, var(--emap-example-primary) 20%, transparent);
              outline-offset: 2px;
            }

            .emap-example-banner-brand img {
              width: 18px;
              height: 18px;
              display: block;
            }

            #header > strong {
              min-width: 0;
              overflow: hidden;
              color: var(--emap-example-muted-foreground);
              font: 500 11px/1.3333 var(--emap-example-font);
              text-overflow: ellipsis;
              white-space: nowrap;
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
              font: 11px/1.2 var(--emap-example-font);
              white-space: nowrap;
            }

            #header .emap-example-source-button {
              display: inline-flex;
              align-items: center;
              min-height: 28px;
              box-sizing: border-box;
              padding: 3px 9px;
              border: 1px solid var(--emap-example-input);
              border-radius: 0;
              background: transparent;
              color: var(--emap-banner-ink);
              box-shadow: none;
              font: 500 11px/1.2 var(--emap-example-font);
              cursor: pointer;
            }

            #header .emap-example-source-button:hover {
              background: color-mix(in oklch, var(--emap-example-accent) 50%, transparent);
              color: var(--emap-banner-ink);
            }

            #header .emap-example-source-button:disabled {
              background: transparent;
              color: var(--emap-example-muted-foreground);
              cursor: wait;
              opacity: 0.75;
            }

            #header .emap-example-source-button:focus-visible,
            #header .emap-example-crs-select:focus-visible {
              outline: 3px solid color-mix(in oklch, var(--emap-example-primary) 20%, transparent);
              outline-offset: 2px;
            }

            .emap-example-source-dialog {
              width: min(1100px, calc(100vw - 32px));
              height: min(760px, calc(100vh - 48px));
              max-width: none;
              max-height: none;
              box-sizing: border-box;
              padding: 0;
              border: 1px solid var(--emap-example-border-strong);
              border-radius: 0;
              background: var(--emap-banner-bg);
              color: var(--emap-banner-ink);
              box-shadow: none;
            }

            .emap-example-source-dialog[open] {
              display: flex;
              flex-direction: column;
            }

            .emap-example-source-dialog::backdrop {
              background: rgb(0 0 0 / 0.1);
            }

            .emap-example-source-header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              flex: 0 0 auto;
              padding: 12px 16px;
              border-bottom: 1px solid var(--emap-example-border);
              background: var(--emap-example-muted);
              color: var(--emap-banner-ink);
              font: 13px/1.2 var(--emap-example-font);
            }

            .emap-example-source-close {
              padding: 5px 10px;
              border: 1px solid var(--emap-example-input);
              border-radius: 0;
              background: transparent;
              color: var(--emap-banner-ink);
              cursor: pointer;
            }

            .emap-example-source-close:hover {
              background: color-mix(in oklch, var(--emap-example-accent) 50%, transparent);
            }

            .emap-example-source-close:focus-visible {
              outline: 3px solid color-mix(in oklch, var(--emap-example-primary) 20%, transparent);
              outline-offset: 2px;
            }

            .emap-example-source-dialog pre {
              flex: 1 1 auto;
              min-height: 0;
              margin: 0;
              padding: 16px;
              overflow: auto;
              background: var(--emap-example-background);
              color: var(--emap-banner-ink);
              tab-size: 2;
            }

            .emap-example-source-dialog code {
              font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
              white-space: pre;
            }

            .emap-example-crs-field {
              display: inline-flex;
              align-items: center;
              gap: 6px;
            }

            #header .emap-example-crs-select {
              min-height: 28px;
              padding: 3px 26px 3px 8px;
              border: 1px solid var(--emap-example-input);
              border-radius: 0;
              background: transparent;
              color: var(--emap-banner-ink);
              box-shadow: none;
              font: 500 11px/1 var(--emap-example-font);
            }

            .emap-example-basemap-state {
              color: var(--emap-example-muted-foreground);
            }

            html:has(> body.emap-example-with-floating-header),
            body.emap-example-with-floating-header {
              width: 100%;
              height: 100%;
              overflow: hidden;
            }

            body.emap-example-with-floating-header {
              box-sizing: border-box;
              min-width: 320px;
              height: 100vh;
              margin: 0;
              padding-top: 48px;
              background: var(--emap-example-background);
              color: var(--emap-banner-ink);
              font: 13px/1.3333 var(--emap-example-font);
            }

            body.emap-example-with-floating-header > #header {
              position: fixed;
              z-index: 30;
              top: 0;
              right: 0;
              left: 0;
              box-sizing: border-box;
              min-height: 48px;
              padding: 8px 12px;
              display: flex;
              align-items: center;
              gap: 10px;
            }

            body.emap-example-with-floating-header > #map {
              position: relative;
              min-width: 0;
              width: 100%;
              height: 100%;
              background: var(--emap-example-muted);
            }

            body.emap-example-with-floating-header > .panel {
              top: 60px;
              max-height: calc(100vh - 72px);
              overflow: auto;
              box-sizing: border-box;
            }

            body.emap-example-with-floating-header > .emap-example-workbench {
              position: absolute;
              z-index: 10;
              left: 64px;
              width: min(376px, calc(100vw - 80px));
              margin: 0;
              padding: 0;
              border: 1px solid var(--emap-example-border);
              border-radius: 0;
              background: var(--emap-banner-bg);
              color: var(--emap-banner-ink);
              box-shadow: none;
              font: inherit;
            }

            .emap-example-workbench > summary {
              position: relative;
              min-height: 36px;
              box-sizing: border-box;
              padding: 8px 72px 8px 16px;
              border-bottom: 1px solid var(--emap-example-border);
              cursor: pointer;
              list-style: none;
            }

            .emap-example-workbench > summary::-webkit-details-marker {
              display: none;
            }

            .emap-example-workbench > summary::after {
              position: absolute;
              top: 11px;
              right: 16px;
              color: var(--emap-example-muted-foreground);
              content: "收起";
              font-size: 11px;
              font-weight: 500;
            }

            .emap-example-workbench:not([open]) > summary {
              border-bottom: 0;
            }

            .emap-example-workbench:not([open]) > summary::after {
              content: "展开";
            }

            .emap-example-workbench > summary > h1 {
              margin: 0;
              font-size: 14px;
              font-weight: 600;
              letter-spacing: -0.01em;
              line-height: 1.3;
            }

            .emap-example-workbench h1,
            .emap-example-workbench h2,
            .emap-example-workbench p {
              overflow-wrap: anywhere;
            }

            .emap-example-workbench-body {
              padding: 16px;
            }

            .emap-example-workbench-body h2 {
              margin: 0 0 12px;
              font-size: 13px;
              font-weight: 600;
              letter-spacing: -0.01em;
              line-height: 1.3;
            }

            .emap-example-section {
              margin-top: 16px;
              padding-top: 16px;
              border-top: 1px solid var(--emap-example-border);
            }

            .emap-example-section:first-child {
              margin-top: 0;
              padding-top: 0;
              border-top: 0;
            }

            .emap-example-field {
              display: grid;
              gap: 6px;
              margin-top: 12px;
            }

            .emap-example-field:first-child,
            .emap-example-field:first-of-type {
              margin-top: 0;
            }

            .emap-example-field[hidden] {
              display: none;
            }

            .emap-example-field > label,
            .emap-example-label {
              color: var(--emap-example-muted-foreground);
              font-size: 11px;
              font-weight: 500;
            }

            .emap-example-row {
              display: flex;
              flex-wrap: wrap;
              gap: 8px;
              align-items: center;
              margin-top: 12px;
            }

            .emap-example-check {
              display: flex;
              gap: 6px;
              align-items: center;
            }

            .emap-example-workbench button,
            .emap-example-workbench input,
            .emap-example-workbench select,
            .emap-example-workbench textarea {
              min-height: 32px;
              box-sizing: border-box;
              border: 1px solid var(--emap-example-input);
              border-radius: 0;
              background: transparent;
              color: inherit;
              font: inherit;
            }

            .emap-example-workbench button {
              padding: 0 10px;
              cursor: pointer;
            }

            .emap-example-workbench button:disabled {
              cursor: not-allowed;
              opacity: 0.5;
            }

            .emap-example-workbench input[type="text"],
            .emap-example-workbench input[type="number"],
            .emap-example-workbench input[type="file"],
            .emap-example-workbench select,
            .emap-example-workbench textarea {
              width: 100%;
              padding: 0 10px;
            }

            .emap-example-workbench input[type="file"] {
              padding: 5px 8px;
            }

            .emap-example-workbench input[type="file"]::file-selector-button {
              min-height: 24px;
              margin-right: 8px;
              padding: 0 8px;
              border: 1px solid var(--emap-example-border-strong);
              border-radius: 0;
              background: var(--emap-example-muted);
              color: inherit;
              font: inherit;
              cursor: pointer;
            }

            .emap-example-workbench input[type="checkbox"],
            .emap-example-workbench input[type="radio"] {
              width: auto;
              min-height: 0;
            }

            .emap-example-workbench input[type="range"] {
              width: 100%;
              padding: 0;
            }

            .emap-example-workbench input[type="color"] {
              width: 100%;
              height: 32px;
              padding: 0;
            }

            .emap-example-workbench textarea {
              min-height: 96px;
              padding: 8px 10px;
              resize: vertical;
            }

            .emap-example-workbench button:focus-visible,
            .emap-example-workbench input:focus-visible,
            .emap-example-workbench select:focus-visible,
            .emap-example-workbench textarea:focus-visible,
            .emap-example-workbench > summary:focus-visible,
            body.emap-example-with-floating-header > #map:focus-visible {
              outline: 3px solid color-mix(in oklch, var(--emap-example-primary) 20%, transparent);
              outline-offset: 2px;
            }

            .emap-example-primary-button {
              width: 100%;
              margin-top: 16px;
              border-color: var(--emap-example-primary);
              background: var(--emap-example-primary);
              color: var(--emap-example-primary-foreground);
              font-weight: 500;
            }

            .emap-example-primary-button:hover:not(:disabled) {
              background: color-mix(in oklch, var(--emap-example-primary), transparent 20%);
            }

            .emap-example-hint {
              margin: 6px 0 0;
              color: var(--emap-example-muted-foreground);
              font-size: 11px;
              line-height: 1.5;
            }

            .emap-example-status {
              margin: 16px 0 0;
              padding: 8px 10px;
              border-left: 3px solid var(--emap-example-border-strong);
              background: var(--emap-example-muted);
              color: var(--emap-example-muted-foreground);
              font-size: 11px;
              line-height: 1.5;
              overflow-wrap: anywhere;
            }

            .emap-example-status[data-state="ready"] {
              border-left-color: var(--emap-example-primary);
              background: var(--emap-example-selection);
              color: var(--emap-banner-ink);
            }

            .emap-example-status[data-state="error"] {
              border-left-color: var(--emap-example-error);
              color: var(--emap-example-error);
            }

            .emap-example-status[data-state="loading"] {
              border-left-color: var(--emap-example-info);
              color: var(--emap-example-info);
            }

            @media (max-width: 1023px) {
              #header > strong {
                display: none;
              }
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

            @media (max-width: 520px) {
              .emap-example-banner-brand span {
                display: none;
              }

              #header .emap-example-crs-field > span {
                display: none;
              }

              #header .emap-example-crs-select {
                width: 108px;
                padding-right: 20px;
              }

              .emap-example-workbench > summary,
              .emap-example-workbench-body {
                padding-right: 12px;
                padding-left: 12px;
              }
            }
          `,
          injectTo: 'head',
        },
        {
          tag: 'script',
          attrs: { id: 'emap-example-source', type: 'application/json' },
          children: JSON.stringify(html).replace(/</g, '\\u003c'),
          injectTo: 'body',
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
