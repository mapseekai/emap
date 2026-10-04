import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chromium, firefox, webkit } from '@playwright/test';
import config from '../playwright.config.mjs';

const engines = { chromium, firefox, webkit };
const server = createServer((_, response) => response.end('<!doctype html>'));
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  for (const { name, use } of [...config.projects, {name: 'chrome-swiftshader', use: {...config.projects[0].use, launchOptions: {args: ['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader']}}}]) {
    const browser = await engines[use.browserName].launch({
      headless: use.headless ?? config.use.headless,
      channel: use.channel,
      ...use.launchOptions,
    });
    try {
      const page = await browser.newPage();
      page.on('console', message => console.log(name, message.text()));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const result = await page.evaluate(async () => {
        console.log('before-WebGL', Boolean(await navigator.gpu?.requestAdapter({featureLevel:'core',powerPreference:'high-performance'})));
        const gl = document.createElement('canvas').getContext('webgl2');
        const pixel = new Uint8Array(4);
        if (gl) {
          gl.clearColor(1, 0, 0, 1);
          gl.clear(gl.COLOR_BUFFER_BIT);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        }
        for (const options of [{}, { featureLevel: 'core' }, { powerPreference: 'high-performance' }, { featureLevel: 'core', powerPreference: 'high-performance' }]) {
          const candidate = await navigator.gpu?.requestAdapter(options);
          console.log('adapter-probe', JSON.stringify({options, available: Boolean(candidate), info: candidate?.info && {vendor:candidate.info.vendor, architecture:candidate.info.architecture, device:candidate.info.device, description:candidate.info.description}}));
        }
        const adapter = await navigator.gpu?.requestAdapter();
        const device = await adapter?.requestDevice();
        let gpuPixel;
        if (device) {
          const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
          const buffer = device.createBuffer({ size: 256, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), clearValue: [1, 0, 0, 1], loadOp: 'clear', storeOp: 'store' }] });
          pass.end();
          encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: 256 }, [1, 1]);
          device.queue.submit([encoder.finish()]);
          await buffer.mapAsync(GPUMapMode.READ);
          gpuPixel = Array.from(new Uint8Array(buffer.getMappedRange()).slice(0, 4));
          device.destroy();
        }
        return { gl: Boolean(gl), pixel: Array.from(pixel), gpu: Boolean(device), gpuPixel, adapter: adapter?.info?.description };
      });
      console.log(name, JSON.stringify(result));
      assert.deepEqual(result.pixel, [255, 0, 0, 255], `${name} WebGL2`);
      if (name !== 'webkit') assert.deepEqual(result.gpuPixel, [255, 0, 0, 255], `${name} WebGPU`);
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
