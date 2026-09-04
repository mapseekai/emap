import { expect, test } from '@playwright/test';

function collectRuntimeErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test('example catalog is generated from the shared manifest', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/mapseekai/emap/examples/');

  await expect(page.locator('a.example-card')).toHaveCount(90);
  await expect(page.locator('.catalog-total-count')).toContainText('90');
  await expect(page.locator('a.example-card').first()).toHaveAttribute(
    'href',
    /\/mapseekai\/emap\/examples\//,
  );
  expect(errors).toEqual([]);
});

test('GeoJSON viewer paints a real Canvas and survives pointer navigation', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/mapseekai/emap/examples/getting-started/geojson-viewer/');

  const status = page.locator('#status');
  await expect(status).toContainText('当前:');
  const canvas = page.locator('#map canvas').first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(async () =>
      canvas.evaluate((element) => {
        const context = element.getContext('2d');
        if (!context || element.width === 0 || element.height === 0) return 0;
        const pixels = context.getImageData(0, 0, element.width, element.height).data;
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 64) {
          if (pixels[index] !== 0) painted += 1;
        }
        return painted;
      }),
    )
    .toBeGreaterThan(0);

  const map = page.locator('#map');
  await map.click({ position: { x: 320, y: 240 } });
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);

  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});
