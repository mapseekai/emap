import { test, expect } from '@playwright/test';
for (const backend of ['webgl', 'webgpu']) {
  test(`${backend}: diagnostic loading`, async ({ page }) => {
    test.setTimeout(90_000);
    page.on('pageerror', (error) => console.log('pageerror', error.message));
    page.on('console', (message) => { if (message.type() === 'error') console.log('console', message.text()); });
    await page.addInitScript(() => {
      window.probeFrames = 0;
      const frame = () => { window.probeFrames++; requestAnimationFrame(frame); };
      requestAnimationFrame(frame);
    });
    const start = Date.now();
    await page.goto('/mapseekai/emap/examples/luma-25d/?gpu=' + backend);
    await expect.poll(async () => {
      const state = await page.evaluate(() => ({
        status: document.querySelector('#status')?.dataset.state,
        text: document.querySelector('#status')?.textContent,
        frames: window.probeFrames,
        visibility: document.visibilityState,
        snapshot: window.luma25d?.snapshot,
      }));
      console.log(JSON.stringify({ backend, elapsed: Date.now() - start, ...state }));
      return state.status;
    }, { timeout: 60_000, intervals: [1000, 5000] }).toBe('ready');
  });
}
