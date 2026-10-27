import { test, expect } from '@playwright/test';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';

async function setup(page, renderer) {
  await installCanvasReadback(page);
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  await page.evaluate(async renderer => {
    lumaBenchmark.dispose();
    document.body.replaceChildren();
    const host = document.createElement('div');
    host.id = 'editing-map';
    Object.assign(host.style, {position: 'fixed', left: '0', top: '0', width: '800px', height: '600px'});
    document.body.append(host);
    const map = window.editingMap = await emap.Emap.create({container: host, renderer});
    window.editingErrors = [];
    map.on('error', event => editingErrors.push(String(event.error)));
    for (const [id, geometry, type, paint] of [
      ['area', {type: 'Polygon', coordinates: [[[-3,-2],[-1,-2],[-1,0],[-3,0],[-3,-2]]]}, 'fill', {'fill-color': '#2266cc', 'line-width': 0}],
      ['road', {type: 'LineString', coordinates: [[-3,2],[3,2]]}, 'line', {'line-color': '#22aa44', 'line-width': 6}],
    ]) {
      const source = new emap.TopologySource(id);
      await source.setData({filename: id+'.geojson', content: new TextEncoder().encode(JSON.stringify({type: 'Feature', properties: {name: id}, geometry}))});
      await map.addSource(id, source);
      map.addLayer({id, source: id, type, paint});
    }
    map.setExtent(new emap.Bounds(-4,-4,4,4));
    window.editingState = () => ({
      selection: map.getSelection(),
      sources: ['area', 'road'].map(id => {
        const dataset = map.getSource(id).getDataset();
        return dataset.layers.map(layer => ({
          records: layer.data?.getRecords(),
          paths: layer.shapes.map(shape => shape.map(part => {
            const points = [], iterator = dataset.arcs.getShapeIter(part);
            while (iterator.hasNext()) points.push([iterator.x, iterator.y]);
            return points;
          })),
        }));
      }),
    });
    window.editingPixel = async (x, y) => {
      // Read the main renderer canvas, never the Canvas editing overlay.
      map.render();
      const canvas = host.querySelector('canvas');
      const pixels = await readCanvasPixels(canvas);
      const point = map.getTransform().project(x, y), dpr = window.devicePixelRatio || 1;
      const index = (Math.round(point[1]*dpr)*canvas.width + Math.round(point[0]*dpr))*4;
      return [...pixels.slice(index, index+4)];
    };
    map.render();
  }, renderer);
  expect(await page.evaluate(() => editingMap.getRenderer())).toBe(renderer);
}

async function click(page, coordinate, offset = [0,0], options = {}) {
  const pixel = await page.evaluate(point => editingMap.getTransform().project(...point), coordinate);
  await page.mouse.move(pixel[0]+offset[0], pixel[1]+offset[1]);
  await page.mouse.click(pixel[0]+offset[0], pixel[1]+offset[1], options);
}

async function finish(page) {
  await page.mouse.click(750, 550, {button: 'right'});
}

async function dispose(page, errors) {
  expect(await page.evaluate(() => editingErrors)).toEqual([]);
  await page.evaluate(() => editingMap.dispose());
  await expect.poll(() => page.workers().length).toBe(0);
  expect(await page.locator('#editing-map canvas').count()).toBe(0);
  expect(errors).toEqual([]);
}

for (const renderer of ['canvas2d', 'webgl2', 'webgpu']) {
  test(`${renderer}: formal drawing snaps to vertices and edges, cancels, and survives undo/redo`, async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await setup(page, renderer);
    const before = await page.evaluate(() => editingState());
    await page.evaluate(() => {
      editingMap.drawFeature.setOptions({source: 'road', type: 'polyline', snapThreshold: 10});
      editingMap.drawFeature.enable();
    });
    await click(page, [-2,3]);
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => editingState())).toEqual(before);
    expect(await page.evaluate(() => editingMap.undo())).toBe(false);
    await click(page, [-3,2], [-3,-3]);
    await click(page, [0,2], [0,-4]);
    await click(page, [0,3], [0,0], {clickCount: 2});
    await expect.poll(() => page.evaluate(() => editingState().sources[1][0].paths.length)).toBe(2);
    await page.evaluate(() => editingMap.drawFeature.disable());
    const after = await page.evaluate(() => editingState());
    const path = after.sources[1][0].paths[1][0];
    expect(path[0]).toEqual([-3,2]);
    expect(path[1][0]).toBeCloseTo(0, 8);
    expect(path[1][1]).toBeCloseTo(2, 8);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,2.5))[1])).toBeGreaterThan(140);
    expect(await page.evaluate(() => editingMap.undo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(before);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,2.5))[3])).toBe(0);
    expect(await page.evaluate(() => editingMap.redo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(after);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,2.5))[1])).toBeGreaterThan(140);
    await dispose(page, errors);
  });

  test(`${renderer}: formal polygon cutting and line reshaping preserve geometry, attributes and selection through history`, async ({page}) => {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await setup(page, renderer);
    await page.evaluate(() => {
      editingMap.select(editingMap.queryFeatures(editingMap.getTransform().project(-2,-1)));
      editingMap.splitFeature.setOptions({cutterType: 'polyline'});
      editingMap.splitFeature.enable();
    });
    const before = await page.evaluate(() => editingState());
    expect(before.selection).toHaveLength(1);
    await click(page, [-2,-3]);
    await page.keyboard.press('Escape');
    await finish(page);
    expect(await page.evaluate(() => editingState())).toEqual(before);
    await click(page, [-2,-3]);
    await click(page, [-2,1]);
    await finish(page);
    await expect.poll(() => page.evaluate(() => editingState().sources[0][0].paths.length)).toBe(2);
    await page.evaluate(() => editingMap.splitFeature.disable());
    const split = await page.evaluate(() => editingState());
    expect(split.selection.map(ref => ref.id).sort()).toEqual([0,1]);
    expect(split.sources[0][0].records).toEqual([{name: 'area'}, {name: 'area'}]);
    const picked = await page.evaluate(() => [-2.5,-1.5].map(x => editingMap.queryFeatures(editingMap.getTransform().project(x,-1))[0]?.id));
    expect([...picked].sort()).toEqual([0,1]);
    expect(await page.evaluate(() => editingMap.undo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(before);
    expect(await page.evaluate(() => editingMap.redo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(split);

    // Reshape follows contacted geometry even with a different source selected.
    await page.evaluate(() => editingMap.reshapeFeature.enable());
    await click(page, [-2,2]);
    await click(page, [0,3]);
    await click(page, [2,2]);
    await finish(page);
    await expect.poll(() => page.evaluate(() => editingState().sources[1])).not.toEqual(split.sources[1]);
    await page.evaluate(() => editingMap.reshapeFeature.disable());
    const reshaped = await page.evaluate(() => editingState());
    expect(reshaped.selection).toEqual(split.selection);
    expect(reshaped.sources[0]).toEqual(split.sources[0]);
    expect(reshaped.sources[1][0].records).toEqual([{name: 'road'}]);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,3))[1])).toBeGreaterThan(140);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,2))[3])).toBe(0);
    expect(await page.evaluate(() => editingMap.undo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(split);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,2))[1])).toBeGreaterThan(140);
    expect(await page.evaluate(() => editingMap.redo())).toBe(true);
    expect(await page.evaluate(() => editingState())).toEqual(reshaped);
    await expect.poll(() => page.evaluate(async () => (await editingPixel(0,3))[1])).toBeGreaterThan(140);
    await dispose(page, errors);
  });
}

for (const renderer of ['canvas2d', 'webgl2']) {
  for (const reverse of [false, true]) {
    test(`${renderer}: polygon winding #35 (${reverse ? 'CW dblclick' : 'CCW close click'}) supports history and hole tools`, async ({page}) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await setup(page, renderer);
      const before = await page.evaluate(() => editingState());
      await page.evaluate(() => {
        editingMap.drawFeature.setOptions({source: 'area', type: 'polygon', snapToVertex: false, snapToEdge: false});
        editingMap.drawFeature.enable();
      });
      const points = [[0,-2],[3,-2],[3,1],[0,1]];
      if (reverse) points.reverse();
      for (const point of points) await click(page, point);
      if (reverse) await click(page, points.at(-1), [0,0], {clickCount: 2});
      else await click(page, points[0]);
      await expect.poll(() => page.evaluate(() => editingState().sources[0][0].paths.length)).toBe(2);
      await page.evaluate(() => editingMap.drawFeature.disable());
      const after = await page.evaluate(() => editingState());
      const area = await page.evaluate(() => {
        const dataset = editingMap.getSource('area').getDataset();
        return emap.getDefaultMapshaperAdapter().exportPathData(dataset.layers[0].shapes[1], dataset.arcs, 'polygon').pathData[0].area;
      });
      expect(area).toBeCloseTo(9, 8);
      for (let cycle = 0; cycle < 2; cycle++) {
        expect(await page.evaluate(() => editingMap.undo())).toBe(true);
        expect(await page.evaluate(() => editingState())).toEqual(before);
        expect(await page.evaluate(() => editingMap.redo())).toBe(true);
        expect(await page.evaluate(() => editingState())).toEqual(after);
      }
      await page.evaluate(() => {
        editingMap.select(editingMap.queryFeatures(editingMap.getTransform().project(2,0)));
        editingMap.ringEdit.setOptions({mode: 'add'});
        editingMap.ringEdit.enable();
      });
      for (const point of [[0.5,-1.5],[1.5,-1.5],[1.5,-0.5],[0.5,-0.5]]) await click(page, point);
      await finish(page);
      await expect.poll(() => page.evaluate(() => editingState().sources[0][0].paths[1].length)).toBe(2);
      await page.evaluate(() => editingMap.ringEdit.setOptions({mode: 'fill'}));
      await click(page, [1,-1]);
      await expect.poll(() => page.evaluate(() => editingState().sources[0][0].paths.length)).toBe(3);
      await page.evaluate(() => editingMap.undo());
      await page.evaluate(() => editingMap.ringEdit.setOptions({mode: 'delete'}));
      await click(page, [1,-1]);
      await expect.poll(() => page.evaluate(() => editingState().sources[0][0].paths[1].length)).toBe(1);
      await page.evaluate(() => editingMap.ringEdit.disable());
      expect((await page.evaluate(() => editingState())).sources).toEqual(after.sources);
      await dispose(page, errors);
    });
  }
}
