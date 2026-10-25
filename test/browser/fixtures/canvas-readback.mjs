/** Preserve submitted WebGPU render attachments for raw RGBA assertions after presentation. */
export async function installCanvasReadback(page) {
  await page.addInitScript(() => {
    if (window.readCanvasPixels) return;
    const frames = new WeakMap();
    const retire = frame => {
      if (!frame) return;
      frame.retired = true;
      frame.bitmap.then(bitmap => { if (!frame.readers) bitmap.close(); }, () => {});
    };
    if (typeof GPUCanvasContext !== 'undefined' && typeof GPUQueue !== 'undefined') {
      const contexts = new WeakMap(), targets = new WeakMap();
      const encoders = new WeakMap(), buffers = new WeakMap();
      const configure = GPUCanvasContext.prototype.configure;
      GPUCanvasContext.prototype.configure = function (options) {
        const result = configure.call(this, options);
        const previous = contexts.get(this);
        if (previous) previous.active = false;
        contexts.set(this, {queue: options.device.queue, canvas: this.canvas, active: true});
        retire(frames.get(this.canvas)); frames.delete(this.canvas);
        return result;
      };
      const unconfigure = GPUCanvasContext.prototype.unconfigure;
      GPUCanvasContext.prototype.unconfigure = function () {
        const result = unconfigure.call(this), context = contexts.get(this);
        if (context) context.active = false;
        contexts.delete(this); retire(frames.get(this.canvas)); frames.delete(this.canvas);
        return result;
      };
      const current = GPUCanvasContext.prototype.getCurrentTexture;
      GPUCanvasContext.prototype.getCurrentTexture = function () {
        const texture = current.call(this), context = contexts.get(this);
        if (context) targets.set(texture, context);
        return texture;
      };
      const createView = GPUTexture.prototype.createView;
      GPUTexture.prototype.createView = function (...args) {
        const view = createView.apply(this, args), context = targets.get(this);
        if (context) targets.set(view, context);
        return view;
      };
      const begin = GPUCommandEncoder.prototype.beginRenderPass;
      GPUCommandEncoder.prototype.beginRenderPass = function (descriptor) {
        const attachments = Array.from(descriptor.colorAttachments);
        const pass = begin.call(this, {...descriptor, colorAttachments: attachments});
        for (const attachment of attachments) for (const view of [attachment?.view, attachment?.resolveTarget]) {
          const context = targets.get(view);
          if (!context) continue;
          let used = encoders.get(this);
          if (!used) encoders.set(this, used = new Set());
          used.add(context);
        }
        return pass;
      };
      const finish = GPUCommandEncoder.prototype.finish;
      GPUCommandEncoder.prototype.finish = function (...args) {
        const buffer = finish.apply(this, args), used = encoders.get(this);
        if (used) buffers.set(buffer, used);
        encoders.delete(this);
        return buffer;
      };
      const submit = GPUQueue.prototype.submit;
      GPUQueue.prototype.submit = function (commands) {
        const submitted = Array.from(commands), result = submit.call(this, submitted), canvases = new Set();
        for (const buffer of submitted) {
          for (const context of buffers.get(buffer) ?? []) {
            if (context.active && context.queue === this) canvases.add(context.canvas);
          }
          buffers.delete(buffer);
        }
        for (const canvas of canvases) {
          if (!canvas.width || !canvas.height) {
            retire(frames.get(canvas)); frames.delete(canvas); continue;
          }
          // Current engine frames write colour/resolve attachments. Unrelated submissions
          // must not consume a texture acquisition or replace its submitted frame.
          // Reading later must not redraw the map or replace alpha with compositor pixels.
          const frame = {bitmap: createImageBitmap(canvas), width: canvas.width,
            height: canvas.height, readers: 0, retired: false};
          retire(frames.get(canvas)); frames.set(canvas, frame);
          frame.bitmap.catch(() => {});
        }
        return result;
      };
    }
    window.readCanvasPixels = async canvas => {
      if (!canvas.width || !canvas.height) return new Uint8ClampedArray();
      const captured = frames.get(canvas);
      const frame = captured?.width === canvas.width && captured?.height === canvas.height
        ? captured : undefined;
      if (frame) frame.readers++;
      let bitmap;
      const copy = document.createElement('canvas');
      try {
        bitmap = await (frame?.bitmap ?? createImageBitmap(canvas));
        copy.width = bitmap.width; copy.height = bitmap.height;
        const context = copy.getContext('2d', { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, copy.width, copy.height).data;
      } finally {
        copy.width = copy.height = 0;
        if (frame) { if (!--frame.readers && frame.retired) bitmap?.close(); }
        else bitmap?.close();
      }
    };
  });
}
