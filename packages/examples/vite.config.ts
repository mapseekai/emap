import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const routeIds = [
  'getting-started/geojson-viewer',
  'getting-started/points',
  'getting-started/lines',
  'getting-started/polygons',
  'getting-started/polygon-fill',
] as const;

const htmlInput = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
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
