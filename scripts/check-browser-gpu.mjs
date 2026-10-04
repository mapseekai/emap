import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from '@playwright/test';
import config from '../playwright.config.mjs';

const engines = { chromium, firefox, webkit };
const server = createServer((_, response) => response.end('<!doctype html>'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const { name, use } of config.projects) {
    const browser = await engines[use.browserName].launch({
      headless: use.headless ?? config.use.headless,
      channel: use.channel,
      ...use.launchOptions,
    });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const pixel = new Uint8Array(4);
        if (gl) {
          gl.clearColor(1, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        }
        const adapter = await navigator.gpu?.requestAdapter({ featureLevel: 'core', powerPreference: 'high-performance' });
        const device = await adapter?.requestDevice();
        let gpuPixel;
        let presentedPixel;
        if (device) {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 4;
          document.body.append(canvas);
          const context = canvas.getContext('webgpu');
          context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat(), alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          const texture = context.getCurrentTexture();
          const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: [0, 1, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
          pass.end();
          encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [1, 1]);
          device.queue.submit([encoder.finish()]);
          const snapshot = createImageBitmap(canvas);
          await buffer.mapAsync(GPUMapMode.READ);
          gpuPixel = Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4));
          const bitmap = await snapshot;
          const copy = document.createElement('canvas').getContext('2d');
          copy.drawImage(bitmap, 0, 0);
          presentedPixel = Array.from(copy.getImageData(0, 0, 1, 1).data);
          bitmap.close();
          context.unconfigure();
          device.destroy();
        }
        return { gl: Boolean(gl), pixel: Array.from(pixel), gpu: Boolean(device), gpuPixel, presentedPixel, adapter: adapter?.info?.architecture };
      });
      console.log(name, JSON.stringify(result));
      assert.deepEqual(result.pixel, [255, 0, 0, 255], `${name} WebGL2`);
      if (name !== 'webkit') {
        assert.deepEqual(result.gpuPixel, [0, 255, 0, 255], `${name} WebGPU texture`);
        assert.deepEqual(result.presentedPixel, [0, 255, 0, 255], `${name} WebGPU canvas`);
      }
    } catch (error) {
      console.error(name, error);
      process.exitCode = 1;
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
