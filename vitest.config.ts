import { fileURLToPath } from 'node:url';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@mapseekai/emap/arrow',
        replacement: fileURLToPath(new URL('./src/arrow/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/duckdb',
        replacement: fileURLToPath(new URL('./src/duckdb/index.ts', import.meta.url)),
      },
      {
        find: '@mapseekai/emap/style.css',
        replacement: fileURLToPath(new URL('./src/ui/controls.css', import.meta.url)),
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
