import { defineConfig } from '@playwright/test';

const linuxCI = Boolean(process.env.CI) && process.platform === 'linux';

export default defineConfig({
  testDir: './test/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chrome',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        // Opt in to software WebGPU on the isolated Linux test runner.
        launchOptions: {
          args: linuxCI
            ? [
                '--enable-unsafe-webgpu',
                '--enable-features=Vulkan',
                '--use-angle=swiftshader',
                '--use-vulkan=swiftshader',
                '--use-webgpu-adapter=swiftshader',
                '--disable-vulkan-surface',
              ]
            : [],
        },
      },
    },
    // macOS Firefox exposes navigator.gpu headlessly but cannot supply an adapter.
    {
      name: 'firefox',
      // Concurrent headed Firefox instances on macOS can stall native RAF.
      workers: process.platform === 'darwin' ? 1 : undefined,
      use: {
        browserName: 'firefox',
        headless: process.platform !== 'darwin' && !linuxCI,
        launchOptions: {
          // Keep rendering when the test browser loses focus.
          firefoxUserPrefs: {
            'layout.testing.top-level-always-active': true,
            ...(linuxCI ? { 'dom.webgpu.enabled': true } : {}),
          },
        },
      },
    },
    // Release scope: Safari/WebGPU is deferred; retain Canvas2D and WebGL2 coverage.
    { name: 'webkit', use: { browserName: 'webkit' }, grepInvert: /\bwebgpu\b/i },
  ],
  webServer: {
    command: 'pnpm --filter @mapseekai/emap-examples preview --port 4173',
    url: 'http://127.0.0.1:4173/mapseekai/emap/examples/',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
