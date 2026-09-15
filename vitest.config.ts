import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@mapseekai/emap/arrow',
        replacement: fileURLToPath(new URL('./src/integrations/arrow/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/duckdb',
        replacement: fileURLToPath(new URL('./src/integrations/duckdb/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/style.css',
        replacement: fileURLToPath(new URL('./src/ui/controls.css', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/context',
        replacement: fileURLToPath(new URL('./src/runtime/context/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/services',
        replacement: fileURLToPath(new URL('./src/runtime/services/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/providers',
        replacement: fileURLToPath(new URL('./src/runtime/providers/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/plugins',
        replacement: fileURLToPath(new URL('./src/runtime/plugins/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/presets',
        replacement: fileURLToPath(new URL('./src/runtime/presets/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/ai',
        replacement: fileURLToPath(new URL('./src/runtime/ai/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/maplibre',
        replacement: fileURLToPath(new URL('./src/integrations/maplibre/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/geopackage',
        replacement: fileURLToPath(new URL('./src/integrations/geopackage/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap',
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    maxWorkers: 2,
    // Linked worktrees under .worktrees/ carry their own test suites and
    // config; keep root discovery on the canonical checkout only.
    exclude: [...defaultExclude, '.worktrees/**', 'test/browser/**'],
  },
});
