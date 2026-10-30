import { expect, test } from '@playwright/test';
import { examples } from '../../docs-meta/examples.ts';

const base = '/mapseekai/emap/examples/';
const expectNoOverflow = async (page) => {
  const sizes = await page.evaluate(() => ({
    content: document.body.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport);
};

test('gallery: every example card loads its corresponding screenshot', async ({ page }) => {
  await page.goto(base);
  const images = page.locator('a.example-card .example-preview img');
  await expect(images).toHaveCount(examples.length);
  const captures = await images.evaluateAll(async (nodes) => {
    for (const node of nodes) node.loading = 'eager';
    await Promise.all(nodes.map(node => node.decode()));
    return nodes.map(node => ({
      route: new URL(node.closest('a').href).pathname,
      image: new URL(node.src).pathname,
      width: node.naturalWidth,
      height: node.naturalHeight,
    }));
  });
  for (const capture of captures) {
    expect(capture.image).toBe(capture.route.replace(base, base + 'previews/').replace(/\/$/, '.jpg'));
    expect(capture.width).toBeGreaterThanOrEqual(900);
    expect(capture.height).toBeGreaterThanOrEqual(350);
  }
});

test('gallery: map attribute panels do not block the operation controls', async ({ page }) => {
  await page.goto(base + 'feature-attributes/');
  const operations = page.getByRole('dialog', { name: '示例操作' });
  await expect(operations).toBeVisible();
  await page.getByRole('button', { name: '收起操作', exact: true }).click();
  await expect(operations).not.toBeVisible();
  await page.getByRole('button', { name: '展开操作', exact: true }).click();
  await expect(operations).toBeVisible();
});

for (const width of [1920, 1280, 390, 320])
  test(`gallery: renderer toolbar aligns with the map at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + 'getting-started/lines/');
    await expect(page.locator('body')).toHaveClass(/example-detail/);
    const frame = await page.locator('.example-application').boundingBox();
    const toolbar = await page.locator('.example-demo-toolbar').boundingBox();
    const renderer = await page.getByRole('group', { name: '切换渲染引擎' }).boundingBox();
    const header = await page.locator('#header').evaluate((node) => {
      return [node, ...node.querySelectorAll('.emap-example-map-tools, .emap-example-renderer-tools')].map((item) => {
        const css = getComputedStyle(item);
        return { className: item.className, box: item.getBoundingClientRect().toJSON(), transform: css.transform,
          left: css.left, margin: css.margin, padding: css.padding, width: css.width, flex: css.flex, boxSizing: css.boxSizing };
      });
    });
    expect(toolbar.x).toBe(frame.x);
    expect(renderer.x, JSON.stringify({ frame, renderer, header })).toBeGreaterThanOrEqual(frame.x);
    expect(renderer.x + renderer.width).toBeLessThanOrEqual(frame.x + frame.width);
    if (width === 1920) {
      await page.screenshot({ path: info.outputPath('operations-expanded.png') });
      await page.getByRole('button', { name: '收起操作', exact: true }).click();
      await page.screenshot({ path: info.outputPath('operations-collapsed.png') });
    }
  });

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
      const operations = page.getByRole('dialog', { name: '示例操作' });
      await expect(operations).toBeVisible();
      const overlay = await operations.boundingBox();
      expect(overlay.x).toBeGreaterThanOrEqual(box.x);
      expect(overlay.y).toBeGreaterThanOrEqual(box.y);
      expect(overlay.x + overlay.width).toBeLessThanOrEqual(box.x + box.width);
      expect(overlay.y + overlay.height).toBeLessThanOrEqual(box.y + box.height);
      if (width < 640) {
        expect(overlay.height).toBeLessThanOrEqual(box.height / 2 + 1);
        expect(overlay.y).toBeGreaterThan(box.y + box.height / 2 - 10);
      }
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
  await expect(page.getByRole('dialog', { name: '示例操作' })).toBeVisible();
  await expect(page.locator('.example-detail-heading button')).toHaveCount(2);
  await expect(page.locator('#status')).not.toBeVisible();
  await page.locator('#line-width').evaluate((input) => {
    input.value = '8';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(page.locator('#status')).toHaveText('已更新 line-width');
  await expect(page.locator('#status')).not.toBeVisible();
  await expect(page.locator('#width-output')).toBeVisible();
  await expect(page.locator('#width-output')).toHaveText('8');
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
  await expect(page.getByRole('button', { name: '展开操作', exact: true })).toBeFocused();
  expect(await page.locator('#map').boundingBox()).toEqual(before);
  await expect(page).toHaveURL(/parameters=closed/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '示例操作' })).not.toBeVisible();
  await page.getByRole('button', { name: '展开操作', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '示例操作' })).toBeVisible();
  await expect(page.getByRole('button', { name: '收起操作', exact: true })).toBeFocused();
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
  await page.locator('#line-width').scrollIntoViewIfNeeded();
  await expect(page.locator('#line-width')).toBeVisible();
  await page.getByRole('button', { name: '收起操作', exact: true }).click();
  await page.getByRole('button', { name: '展开操作', exact: true }).click();
  await expect(page.locator('#line-width')).toBeVisible();
  await expectNoOverflow(page);
});

test('gallery: the plugin inspector fits its parameter panel on desktop and mobile', async ({ page }) => {
  await page.goto(base + 'plugin-install/?renderer=canvas2d');
  await expect(page.locator('.runtime-row').first()).toBeVisible();
  const panel = await page.locator('.runtime-panel').boundingBox();
  const container = await page.locator('.example-parameters').boundingBox();
  expect(panel.width).toBeLessThanOrEqual(container.width);
  expect(panel.x + panel.width).toBeLessThanOrEqual(1440);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await page.locator('.runtime-panel').boundingBox();
  expect(mobile.x + mobile.width).toBeLessThanOrEqual(390);
});

test('gallery: file errors remain visible on the map and clear after a successful load', async ({ page }) => {
  await page.goto(base + 'getting-started/lines/?renderer=canvas2d');
  await expect(page.locator('#status')).toContainText('正在显示');
  await expect(page.locator('#status')).not.toBeVisible();
  await page.locator('#status').evaluate((node) => { node.dataset.state = 'ready'; });
  await page.locator('#file-input').setInputFiles({
    name: 'invalid.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from('{'),
  });
  await expect(page.locator('#status')).toContainText('错误:');
  await expect(page.locator('#status')).toBeVisible();
  await page.getByRole('button', { name: '收起操作', exact: true }).click();
  await expect(page.locator('#status')).toBeVisible();
  await page.getByRole('button', { name: '展开操作', exact: true }).click();
  await page.locator('#file-input').setInputFiles('packages/examples/public/fixtures/getting-started-lines.geojson');
  await expect(page.locator('#status')).toContainText('正在显示');
  await expect(page.locator('#status')).not.toBeVisible();
});
