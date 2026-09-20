import { defineConfig } from '@playwright/test';
import base from './playwright.config.mjs';

// Isolate benchmark runs from any user-owned example preview server.
export default defineConfig({
  ...base,
  testMatch: ['luma-benchmark.spec.mjs', 'luma-editor.spec.mjs', 'luma-points.spec.mjs', 'luma-point-lod.spec.mjs'],
  workers: 1,
  // Keep browser cleanup isolated from persisted performance reports.
  outputDir: 'test-results/luma-browser',
  use: { ...base.use, baseURL: 'http://127.0.0.1:4193', viewport: { width: 1280, height: 900 } },
  projects: [{ name: 'chrome', use: { browserName: 'chromium', channel: 'chrome' } }],
  webServer: {
    command:
      'pnpm --filter @mapseekai/emap-examples exec vite preview --host 127.0.0.1 --port 4193 --strictPort',
    url: 'http://127.0.0.1:4193/mapseekai/emap/examples/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
