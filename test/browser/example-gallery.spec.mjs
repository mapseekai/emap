import { expect, test } from '@playwright/test';

const base = '/mapseekai/emap/examples/';
const expectNoOverflow = async (page) => {
  const sizes = await page.evaluate(() => ({
    content: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
};

for (const id of ['getting-started/lines', 'geotiff-viewer', 'luma-25d', 'luma-benchmark', 'luma-vertex-editing', 'plugin-install'])
  for (const [width, height] of [[1280, 800], [390, 844], [320, 740]])
    test(`one viewport: ${id} at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height });
      await page.goto(base + id + '/');
      await expect(page.locator('body')).toHaveClass(/example-detail/);
      const map = page.locator(id === 'luma-benchmark' ? '#stage' : '#map');
      await expect(map).toBeVisible();
      const box = await map.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);
      expect(box.height).toBeGreaterThan(height * 0.6);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(height);
      await expectNoOverflow(page);
      await expect(page.locator('#example-guide, .example-detail-description')).toHaveCount(0);
      await expect(page.locator('#example-source')).not.toBeVisible();
      if (width === 1280 || (id === 'getting-started/lines' && width === 390))
        await page.screenshot({ path: info.outputPath('one-screen.png') });
    });

test('gallery: category search, language, and list view keep the matching example', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('#app')).toHaveAttribute('data-view', 'grid');
  await expect(page.locator('.catalog-example-navigation a')).toHaveCount(105);
  await expect(page.locator('.catalog-page-navigation')).toBeVisible();
  await page.locator('.catalog-category-tabs [data-category="style"]').click();
  await expect(page.locator('a.example-card')).toHaveCount(7);
  await page.locator('.catalog-category-button[data-category="data-layers"]').click();
  await page.locator('.catalog-search-input').fill('TopologySource.fromBytes');
  await expect(page.locator('a.example-card')).toHaveCount(1);
  await expect(page).toHaveURL(/category=data-layers/);
  await page.reload();
  await expect(page.locator('.catalog-search-input')).toHaveValue('TopologySource.fromBytes');
  await expect(page.locator('a.example-card')).toHaveCount(1);
  await page.locator('.catalog-language select').selectOption('en');
  await expect(page.locator('.example-card-title')).toHaveText('GeoParquet / GeoArrow viewer');
  await page.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-view', 'grid');
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await expect(page.locator('#app')).toHaveAttribute('data-view', 'list');
  await expect(page.locator('a.example-card')).toHaveAttribute('href', base + 'geoparquet-viewer/');
});

test('gallery: source and operations preserve the running map in the compact layout', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + 'getting-started/lines/?renderer=canvas2d');
  await expect(page.locator('#status')).toContainText('正在显示');
  await expect(page.locator('#example-source')).not.toBeVisible();
  await expect(page.getByRole('tab', { name: '说明与参数' })).toHaveCount(0);
  await page.getByRole('button', { name: '操作', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '示例操作' })).toBeVisible();
  await page.locator('#line-width').evaluate((input) => {
    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#status')).toHaveText('已更新 line-width');
  await expect(page.locator('.example-control-help')).toHaveCount(0);
  const before = await page.locator('#map').boundingBox();
  await page.locator('#map').evaluate((map) => { map.dataset.runningInstance = 'original'; });
  await page.getByRole('tab', { name: '源码', exact: true }).click();
  await expect(page.locator('.example-source-code')).toContainText('map.setPaintProperty');
  await page.getByRole('tab', { name: '完整 HTML', exact: true }).click();
  await expect(page.locator('.example-source-code')).toContainText('<!doctype html>');
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.locator('#map')).toHaveAttribute('data-running-instance', 'original');
  await expect(page.locator('#line-width')).toHaveValue('8');
  expect((await page.locator('#map').boundingBox()).width).toBe(before.width);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '示例操作' })).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('gallery: mobile catalog and example controls fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page.locator('.catalog-mobile-category select').selectOption('style');
  await expect(page.locator('.catalog-group-title')).toHaveText('样式');
  await expectNoOverflow(page);
  await page.locator('a.example-card').filter({ hasText: '线图层样式' }).click();
  await expect(page.locator('#map')).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const frame = await page.locator('.example-application').boundingBox();
    const map = await page.locator('#map').boundingBox();
    expect(map.width).toBeCloseTo(frame.width - 2, 0);
  }
  await expectNoOverflow(page);
  await page.getByRole('button', { name: '操作', exact: true }).click();
  await page.locator('#line-width').scrollIntoViewIfNeeded();
  await expect(page.locator('#line-width')).toBeVisible();
  await page.getByRole('button', { name: '关闭操作', exact: true }).click();
  await expectNoOverflow(page);
});

test('gallery: the plugin inspector fits its parameter panel on desktop and mobile', async ({ page }) => {
  await page.goto(base + 'plugin-install/?renderer=canvas2d');
  await page.getByRole('button', { name: '操作', exact: true }).click();
  await expect(page.locator('.runtime-row').first()).toBeVisible();
  const panel = await page.locator('.runtime-panel').boundingBox();
  const container = await page.locator('.example-parameters').boundingBox();
  expect(panel.width).toBeLessThanOrEqual(container.width);
  expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.runtime-panel').boundingBox();
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
});
