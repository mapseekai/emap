import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 2500,
    emptyOutDir: true,
    outDir: 'dist',
  },
});
