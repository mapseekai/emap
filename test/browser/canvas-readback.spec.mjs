import { test, expect } from '@playwright/test';
import { installCanvasReadback } from './fixtures/canvas-readback.mjs';

for (const alphaMode of ['premultiplied', 'opaque']) {
  test(`webgpu: raw snapshots retain ${alphaMode} submitted pixels without replaying draws`, async ({page}, info) => {
    await installCanvasReadback(page);
    await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
    await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
    const result = await page.evaluate(async alphaMode => {
      lumaBenchmark.dispose(); document.body.replaceChildren();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16; document.body.append(canvas);
      const adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu');
      context.configure({device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode});
      const submit = device.queue.submit.bind(device.queue);
      let submissions = 0;
      device.queue.submit = commands => { submissions++; submit(commands); };
      const draw = color => {
        const encoder = device.createCommandEncoder();
        encoder.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(),
          clearValue: color, loadOp: 'clear', storeOp: 'store'}]}).end();
        device.queue.submit([encoder.finish()]);
      };
      const nativePixel = async () => {
        const bitmap = await createImageBitmap(canvas), copy = document.createElement('canvas');
        copy.width = bitmap.width; copy.height = bitmap.height;
        const ctx = copy.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const pixel = [...ctx.getImageData(0, 0, 1, 1).data]; copy.width = copy.height = 0;
        return pixel;
      };
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const pixel = async () => [...(await readCanvasPixels(canvas)).slice(0, 4)];
      try {
        draw([0.25, 0, 0, 0.5]);
        const submitted = await nativePixel(); await frame(); await frame();
        const presented = await pixel(), afterRead = submissions;
        draw([0, 0, 0, 0]); await frame(); await frame();
        const cleared = await pixel();
        draw([1, 0, 0, 1]); const reading = pixel(); draw([0, 1, 0, 1]);
        const retired = await reading, latest = await pixel();
        canvas.width = 12;
        const resized = await readCanvasPixels(canvas);
        draw([0, 0, 1, 1]); await frame(); await frame(); const blue = await pixel();
        context.unconfigure();
        const nativeAfterUnconfigure = await nativePixel(), unconfigured = await pixel();
        canvas.width = 0; const empty = await readCanvasPixels(canvas);
        return {submitted, presented, afterRead, cleared, retired, latest, blue, nativeAfterUnconfigure, unconfigured,
          resizedBytes: resized.length, resizedRed: resized[0], emptyBytes: empty.length, submissions};
      } finally { context.unconfigure(); device.destroy(); canvas.remove(); }
    }, alphaMode);
    expect(result.presented).toEqual(result.submitted);
    expect(result.presented[0]).toBeGreaterThan(0);
    expect(result.presented[3]).toBe(alphaMode === 'premultiplied' ? 128 : 255);
    expect(result.afterRead).toBe(1);
    expect(result.cleared).toEqual([0, 0, 0, alphaMode === 'premultiplied' ? 0 : 255]);
    expect(result.retired).toEqual([255, 0, 0, 255]);
    expect(result.latest).toEqual([0, 255, 0, 255]);
    expect(result.resizedBytes).toBe(12 * 16 * 4); expect(result.resizedRed).toBe(0);
    expect(result.blue).toEqual([0, 0, 255, 255]);
    expect(result.unconfigured).toEqual(result.nativeAfterUnconfigure);
    expect(result.emptyBytes).toBe(0); expect(result.submissions).toBe(5);
    await info.attach('submitted-frame-contract', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  });
}


test('webgpu: raw snapshots follow canvas command buffers across unrelated submissions', async ({page}, info) => {
  await installCanvasReadback(page);
  await page.goto('/mapseekai/emap/examples/luma-benchmark/?parameters=open');
  await page.waitForFunction(() => window.lumaBenchmark?.state === 'idle');
  const result = await page.evaluate(async () => {
    lumaBenchmark.dispose(); document.body.replaceChildren();
    const adapter = await navigator.gpu.requestAdapter(), device = await adapter.requestDevice();
    const errors = [], rows = [];
    device.addEventListener('uncapturederror', event => errors.push(event.error.message));
    device.pushErrorScope('validation');
    const pipeline = device.createComputePipeline({layout: 'auto', compute: {
      module: device.createShaderModule({code: '@compute @workgroup_size(1) fn main() {}'}), entryPoint: 'main',
    }});
    const submit = device.queue.submit.bind(device.queue);
    let submissions = 0;
    device.queue.submit = commands => { submissions++; submit(commands); };
    const nativePixel = async canvas => {
      const bitmap = await createImageBitmap(canvas), copy = document.createElement('canvas');
      copy.width = bitmap.width; copy.height = bitmap.height;
      const ctx = copy.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixel = [...ctx.getImageData(0, 0, 1, 1).data]; copy.width = copy.height = 0;
      return pixel;
    };
    const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
    try {
      for (const unrelated of ['empty', 'compute', 'compute-resolve']) {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
        document.body.append(canvas);
        const context = canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({device, format, alphaMode: 'premultiplied'});
        const msaa = unrelated === 'compute-resolve'
          ? device.createTexture({size: [16, 16], format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT}) : undefined;
        try {
          const texture = context.getCurrentTexture(), before = submissions;
          if (unrelated === 'empty') device.queue.submit([]);
          else {
            const compute = device.createCommandEncoder(), pass = compute.beginComputePass();
            pass.setPipeline(pipeline); pass.dispatchWorkgroups(1); pass.end();
            device.queue.submit([compute.finish()]);
          }
          const encoder = device.createCommandEncoder();
          encoder.beginRenderPass({colorAttachments: [{view: msaa ? msaa.createView() : texture.createView(),
            ...(msaa ? {resolveTarget: texture.createView()} : {}),
            clearValue: [0, 0, 1, 1], loadOp: 'clear', storeOp: 'store'}]}).end();
          device.queue.submit(new Set([encoder.finish()]));
          const native = await nativePixel(canvas); await frame(); await frame();
          const blue = [...(await readCanvasPixels(canvas)).slice(0, 4)];
          const clear = device.createCommandEncoder();
          clear.beginRenderPass({colorAttachments: [{view: context.getCurrentTexture().createView(),
            clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'store'}]}).end();
          device.queue.submit([clear.finish()]); await frame(); await frame();
          const transparent = [...(await readCanvasPixels(canvas)).slice(0, 4)];
          rows.push({unrelated, native, blue, transparent, submissions: submissions - before});
        } finally { context.unconfigure(); msaa?.destroy(); canvas.remove(); }
      }
      const validation = await device.popErrorScope();
      if (validation) errors.push(validation.message);
      return {rows, errors};
    } finally { device.destroy(); }
  });
  await info.attach('command-buffer-affinity', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  expect(result.errors).toEqual([]);
  for (const row of result.rows) {
    expect(row.native, row.unrelated).toEqual([0, 0, 255, 255]);
    expect(row.blue, row.unrelated).toEqual(row.native);
    expect(row.transparent, row.unrelated).toEqual([0, 0, 0, 0]);
    expect(row.submissions, row.unrelated).toBe(3);
  }
});
