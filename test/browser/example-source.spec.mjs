import { expect, test } from '@playwright/test';

const base = '/mapseekai/emap/examples/';
async function codeText(page) {
  return page.locator('.example-source-code code').evaluate(node => {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.example-source-line-number').forEach(number => number.remove());
    return clone.textContent;
  });
}

test('source: formats HTML and provides readable JavaScript with line numbers', async ({ page }) => {
  await page.goto(base + 'getting-started/lines/?tab=source');
  await expect(page.locator('.example-source-code .shiki')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'JavaScript', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.example-source-line-number').count()).toBeGreaterThan(30);
  expect(await codeText(page)).toContain('const map = await Emap.create(');
  await page.getByRole('tab', { name: '完整 HTML', exact: true }).click();
  await expect(page.locator('.example-source-code')).toHaveAttribute('aria-busy', 'false');
  expect(await codeText(page)).toContain('\n  <head>\n');
  expect(await codeText(page)).toContain('\n    <script type="module">\n');
  await expect(page.locator('.example-source-details')).toContainText('HTML');
});

test('source: exposes typed implementations, CSS and their matching GitHub links', async ({ page }) => {
  await page.goto(base + 'luma-25d/?tab=source');
  await expect(page.locator('.example-source-code .shiki')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'luma-25d/main.ts', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.example-source-details')).toContainText('TypeScript');
  await page.getByRole('tab', { name: 'luma-25d/style.css', exact: true }).click();
  await expect(page.locator('.example-source-details')).toContainText('CSS');
  await expect(page.locator('.example-source-code')).toHaveAttribute('aria-busy', 'false');
  expect(await codeText(page)).toContain('body {\n');
  await expect(page.getByRole('link', { name: '在 GitHub 查看' })).toHaveAttribute('href', /packages\/examples\/src\/luma-25d\/style\.css$/);
  await page.getByRole('tab', { name: 'luma-25d/style.css', exact: true }).press('End');
  await expect(page.getByRole('tab', { name: '完整 HTML', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '完整 HTML', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.example-source-code')).toHaveAttribute('aria-busy', 'false');
  expect(await codeText(page)).toContain('<!doctype html>');
});

test('source: copies the formatted current file without line numbers and fits a phone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedSource = text; } } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + 'getting-started/lines/?tab=source');
  await expect(page.locator('.example-source-code .shiki')).toBeVisible();
  const code = await codeText(page);
  await page.getByRole('button', { name: '复制代码', exact: true }).click();
  expect(await page.evaluate(() => window.copiedSource)).toBe(code + '\n');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(page.getByRole('link', { name: '在 GitHub 查看' })).toBeVisible();
  await page.getByRole('tab', { name: '地图', exact: true }).click();
  await expect(page.locator('#map')).toBeVisible();
});
