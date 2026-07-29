import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

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
  },
});
