import { installCanvasReadback } from './fixtures/canvas-readback.mjs';
import { expect, test } from '@playwright/test';
import { examples } from '../../docs-meta/examples.ts';

test.beforeEach(async ({page}) => installCanvasReadback(page));

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

  await expect(page.locator('a.example-card')).toHaveCount(examples.length);
  await expect(page.locator('.catalog-total-count')).toContainText(String(examples.length));
  const routes = await page.locator('a.example-card').evaluateAll((cards) =>
    cards.map((card) => new URL(card.href).pathname).sort(),
  );
  expect(routes).toEqual(examples.map((example) => `/mapseekai/emap${example.route}`).sort());
  await expect(page.locator('a.example-card').first()).toHaveAttribute(
    'href',
    /\/mapseekai\/emap\/examples\//,
  );
  expect(errors).toEqual([]);
});

test('vector file viewer paints a real Canvas and survives pointer navigation', async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await page.goto('/mapseekai/emap/examples/getting-started/vector-file/?parameters=open');

  const status = page.locator('#status');
  await expect(status).toContainText('当前:');
  const canvas = page.locator('#map canvas').first();
  await expect(canvas).toBeVisible();

  await expect
    .poll(async () =>
      canvas.evaluate(async (element) => {
        const pixels = await window.readCanvasPixels(element);
        let painted = 0;
        for (let index = 3; index < pixels.length; index += 64) {
          if (pixels[index] !== 0) painted += 1;
        }
        return painted;
      }),
    )
    .toBeGreaterThan(0);

  const map = page.locator('#map');
  await page.getByRole('button', { name: '收起操作', exact: true }).click();
  await map.click({ position: { x: 320, y: 240 } });
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);

  await expect(canvas).toBeVisible();
  expect(errors).toEqual([]);
});

test('GeoParquet SQL output registers with the configured CRS and paints the result', async ({ page }) => {
  await page.goto('/mapseekai/emap/examples/duckdb-geoparquet-query/');
  await expect(page.locator('#output-crs')).toHaveValue('EPSG:4326');
  await expect(page.locator('#status')).toContainText('已查询', { timeout: 45000 });
  const canvas = page.locator('#map canvas').first();
  await expect.poll(async () => canvas.evaluate(async element => {
    const pixels = await window.readCanvasPixels(element);
    let painted = 0;
    for (let index = 3; index < pixels.length; index += 64) if (pixels[index] !== 0) painted++;
    return painted;
  })).toBeGreaterThan(0);
});
