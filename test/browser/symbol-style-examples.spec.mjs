import { expect, test } from '@playwright/test';

async function renderedPixels(page, selector = '#map') {
  const screenshot = await page.locator(selector).screenshot({
    style: '.emap-example-workbench,[aria-label="实时性能监控"],#map :not(canvas){visibility:hidden!important}#map canvas{visibility:visible!important}',
  });
  return page.evaluate(async (png) => {
    const result = { text: 0, fill: 0, blue: 0 };
    const image = await createImageBitmap(new Blob([new Uint8Array(png)], { type: 'image/png' }));
    const copy = document.createElement('canvas');
    copy.width = image.width;
    copy.height = image.height;
    const context = copy.getContext('2d');
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2], a = pixels[i + 3];
      if (a > 100 && r < 100 && g < 100 && b < 120) result.text++;
      if (a > 50 && g > r + 10 && g > b + 5) result.fill++;
      if (a > 150 && r < 80 && g < 150 && b > 180) result.blue++;
    }
    return result;
  }, [...screenshot]);
}

for (const [route, title, prefix] of [
  ['labels', '文字注记', 'label'],
  ['point-icons', '点图标', 'icon'],
]) {
  for (const renderer of ['canvas2d', 'webgl2', 'webgpu'])
  test(`${renderer} ${route}: loads data and applies symbol settings`, async ({ page }, info) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/mapseekai/emap/examples/${route}/?parameters=open&renderer=${renderer}`);
    await expect(page).toHaveTitle(new RegExp(title));
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('body')).toHaveClass(/emap-example-with-floating-header/);
    await expect(page.locator('.emap-example-workbench')).toBeVisible();
    await expect(page.locator('#map canvas').first()).toBeVisible();
    await expect(page.locator(`#${prefix}-enabled`)).toBeChecked();
    await expect(page.locator(`#${prefix}-owner option`)).toHaveCount(prefix === 'label' ? 3 : 1);
    if (prefix === 'label') {
      await expect(page.locator('#label-collision')).toBeChecked();
      await expect(page.locator('#label-offset-x')).toHaveValue('0');
      await expect(page.locator('#label-offset-y')).toHaveValue('0');
      await expect.poll(async () => (await renderedPixels(page)).fill).toBeGreaterThan(1000);
      await expect.poll(async () => (await renderedPixels(page)).text).toBeGreaterThan(20);
    } else await expect.poll(async () => (await renderedPixels(page)).blue).toBeGreaterThan(500);
    await page.screenshot({ path: info.outputPath(`${route}-${renderer}.png`) });

    await page.locator(`#${prefix}-size`).fill(prefix === 'label' ? '22' : '2');
    await page.locator(`#${prefix}-size`).dispatchEvent('change');
    await page.locator(`#${prefix}-show-symbol`).click();
    await expect.poll(async () => {
      const symbol = JSON.parse(await page.locator(`#${prefix}-symbol-json`).textContent());
      return symbol.layout[`${prefix === 'label' ? 'text' : 'icon'}-size`];
    }).toBe(prefix === 'label' ? 22 : 2);

    await page.locator('#file-input').setInputFiles({
      name: 'uploaded.geojson',
      mimeType: 'application/geo+json',
      buffer: Buffer.from(JSON.stringify({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { name: 'Uploaded POI' }, geometry: { type: 'Point', coordinates: [0, 0] } }],
      })),
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'ready');
    await expect(page.locator('#status')).toContainText('uploaded.geojson');
    await expect(page.locator(`#${prefix}-owner option`)).toHaveCount(1);
    await expect(page.locator(`#${prefix}-enabled`)).toBeChecked();
    await page.locator('#file-input').setInputFiles({
      name: 'invalid.geojson', mimeType: 'application/geo+json', buffer: Buffer.from('invalid'),
    });
    await expect(page.locator('#status')).toHaveAttribute('data-state', 'error');
    await expect(page.locator(`#${prefix}-owner option`)).toHaveCount(1);
    await expect(page.locator(`#${prefix}-enabled`)).toBeChecked();
    expect(errors).toEqual([]);
  });
}

for (const renderer of ['canvas2d', 'webgl2', 'webgpu'])
test(`${renderer} labels: readable text above points and collision avoidance survive zooming`, async ({ page }, info) => {
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  await page.evaluate(async renderer => {
    window.lumaBenchmark.dispose();
    const host = document.createElement('div');
    host.id = 'symbol-zoom-map';
    Object.assign(host.style, { position: 'fixed', inset: '0', width: '800px', height: '600px', zIndex: '99999', background: 'white' });
    document.body.append(host);
    const map = await emap.Emap.create({ container: host, preset: 'viewer', renderer });
    const source = new emap.TopologySource('stations');
    const points = Array.from({ length: 99 }, (_, i) => [(i % 11) / 10, Math.floor(i / 11) / 10]);
    await source.setData({ filename: 'stations.geojson', content: new TextEncoder().encode(JSON.stringify({
      type: 'FeatureCollection', features: points.map((coordinates, i) => ({
        type: 'Feature', properties: { fid: String(i + 1) }, geometry: { type: 'Point', coordinates },
      })),
    })) });
    await map.addSource('stations', source);
    map.addLayer({ id: 'stations', source: 'stations', type: 'circle',
      paint: { 'circle-color': '#2563eb', 'circle-radius': 3 },
      label: { field: 'fid', fontSize: 24, color: '#243447', haloWidth: 1.5 },
    });
    map.reset();
    window.symbolZoomMap = map;
    window.symbolZoomSnapshot = () => {
      const manager = map.ctx.render._labels;
      const labels = manager?.frame.labels ?? [];
      let intersections = 0;
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i].bounds, b = labels[j].bounds;
        if (a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]) intersections++;
      }
      return { pending: manager?.stats.pending ?? true, navigating: map.ctx.render._navSnapshotTransform !== null, count: labels.length, intersections,
        mapScale: map.ctx.view._viewport.getMapScale(),
        fontPixels: Math.min(...labels.map(label => 24 * (label.scale ?? 1))),
        scale: labels[0]?.scale,
        anchorError: Math.max(0, ...labels.map(label => {
          const p = map.project(...points[label.featureId]);
          return Math.hypot(label.x - p[0], label.y + label.raster.height * (label.scale ?? 1) / 2 - (p[1] - 6));
        })),
      };
    };
  }, renderer);
  await expect.poll(() => page.evaluate(() => {
    const s = symbolZoomSnapshot(); return !s.pending && s.count > 30;
  })).toBe(true);
  const full = await page.evaluate(() => symbolZoomSnapshot());
  const pixels = await renderedPixels(page, '#symbol-zoom-map');
  expect(pixels.text).toBeGreaterThan(100);
  expect(full).toMatchObject({ scale: 1, intersections: 0, anchorError: 0 });
  await page.mouse.move(500, 300);
  // Wheel magnitude selects direction; sustain real input until the intended zoom is reached.
  let wheelEvents = 0;
  while (wheelEvents < 60) {
    await page.mouse.wheel(0, 800);
    wheelEvents++;
    await page.evaluate(() => new Promise(requestAnimationFrame));
    if (await page.evaluate(() => symbolZoomSnapshot().mapScale < 0.1)) break;
  }
  await expect.poll(() => page.evaluate(() => {
    const s = symbolZoomSnapshot(); return !s.pending && !s.navigating && s.count > 0 && s.mapScale < 0.1 && s.fontPixels >= 12 && s.anchorError < 1e-6;
  })).toBe(true);
  const small = await page.evaluate(() => symbolZoomSnapshot());
  expect(small.count).toBeLessThan(full.count);
  expect(small.intersections).toBe(0);
  expect(small.anchorError).toBeLessThan(1e-6);
  expect(small.fontPixels).toBe(12);
  const smallPixels = await renderedPixels(page, '#symbol-zoom-map');
  expect(smallPixels.text).toBeGreaterThan(5);
  expect(smallPixels.text).toBeLessThan(pixels.text);
  await page.evaluate(() => symbolZoomMap.reset());
  await expect.poll(() => page.evaluate(() => symbolZoomSnapshot())).toEqual(full);
  await info.attach('symbol-zoom-evidence', {body: JSON.stringify({full, small, wheelEvents}), contentType: 'application/json'});
  await page.evaluate(() => symbolZoomMap.remove());
});

test('benchmark links to standalone styling examples', async ({ page }) => {
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
  await expect(page.locator('a[href="../labels/"]')).toBeVisible();
  await expect(page.locator('a[href="../point-icons/"]')).toBeVisible();
  await expect(page.locator('#label-settings, #icon-settings')).toHaveCount(0);
});

test('catalog exposes both examples in the styling category', async ({ page }) => {
  await page.goto('/mapseekai/emap/examples/');
  await page.locator('.catalog-category-button[data-category="style"]').click();
  await expect(page.locator('a.example-card[href="/mapseekai/emap/examples/labels/"]')).toBeVisible();
  await expect(page.locator('a.example-card[href="/mapseekai/emap/examples/point-icons/"]')).toBeVisible();
});
