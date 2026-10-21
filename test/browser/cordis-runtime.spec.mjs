import { expect, test } from '@playwright/test';

async function openInspector(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mapseekai/emap/examples/plugin-install/');
  await expect(page.locator('#runtime-proof')).toContainText('Context.is(map.ctx) = true');
  await expect(page.locator('#runtime-proof')).toContainText('cordis@4.0.0-rc.10');
  await expect(page.locator('#selected-status')).toContainText('ACTIVE');
  return errors;
}

async function pan(page) {
  await page.mouse.move(1050, 540);
  await page.mouse.down();
  await page.mouse.move(1140, 585, { steps: 8 });
  await page.mouse.up();
}

test('uses native Cordis fibers for real pointer interaction disposal and reinstallation', async ({ page }) => {
  const errors = await openInspector(page);
  const identity = await page.evaluate(() => {
    const map = window.emapHarness.map;
    return { native: window.emap.Context.is(map.ctx), customRuntime: 'runtime' in map, customServices: 'services' in map };
  });
  expect(identity).toEqual({ native: true, customRuntime: false, customServices: false });
  const initial = await page.evaluate(() => window.emapHarness.map.getCenter());
  await pan(page);
  await expect.poll(() => page.evaluate(() => window.emapHarness.map.getCenter())).not.toEqual(initial);

  await page.locator('#dispose-plugin').click();
  await expect(page.locator('#selected-status')).toContainText('Fiber 已 Dispose');
  const stopped = await page.evaluate(() => window.emapHarness.map.getCenter());
  await pan(page);
  expect(await page.evaluate(() => window.emapHarness.map.getCenter())).toEqual(stopped);

  await page.locator('#reinstall-plugin').click();
  await expect(page.locator('#selected-status')).toContainText('ACTIVE');
  await pan(page);
  await expect.poll(() => page.evaluate(() => window.emapHarness.map.getCenter())).not.toEqual(stopped);
  await page.locator('#restart-plugin').click();
  await expect(page.locator('#action-state')).toContainText('Fiber.restart()');
  await expect(page.locator('#preset-summary')).toContainText('headless');
  await expect(page.locator('#preset-summary')).toContainText('empty');
  expect(errors).toEqual([]);
});

test('dynamically registers formats and suspends DuckDB capabilities through native inject', async ({ page }) => {
  const errors = await openInspector(page);
  const baseline = Number(await page.locator('#metric-capabilities').textContent());
  await expect(page.locator('#metric-formats')).toHaveText('0');
  await page.locator('#install-arrow').click();
  await expect(page.locator('#metric-formats')).toHaveText('1');
  await page.locator('#dispose-plugin').click();
  await expect(page.locator('#metric-formats')).toHaveText('0');
  await page.locator('#reinstall-plugin').click();
  await expect(page.locator('#metric-formats')).toHaveText('1');

  await page.locator('#install-maplibre').click();
  await expect(page.locator('#service-state')).toContainText('MapLibre：已安装');
  await page.locator('#install-duckdb').click();
  await expect.poll(async () => Number(await page.locator('#metric-capabilities').textContent())).toBeGreaterThan(baseline);
  await expect(page.locator('#service-state')).toContainText('尚未初始化');
  await page.locator('#dispose-plugin').click();
  await expect(page.locator('#metric-capabilities')).toHaveText(String(baseline));
  const pending = await page.evaluate(() => window.emapHarness.inspect().filter(fiber => fiber.name.startsWith('capability.duckdb.') && fiber.state === 'PENDING').length);
  expect(pending).toBeGreaterThan(0);
  await page.locator('#reinstall-plugin').click();
  await expect.poll(async () => Number(await page.locator('#metric-capabilities').textContent())).toBeGreaterThan(baseline);
  const actualCrs = await page.evaluate(() => window.emapHarness.map.getCRS());
  await page.locator('#invoke-read').click();
  await expect.poll(async () => {
    try { return JSON.parse(await page.locator('#capability-result').textContent()).value; }
    catch { return undefined; }
  }).toBe(actualCrs);
  expect(errors).toEqual([]);
});
