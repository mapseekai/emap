/** Install a test-only snapshot reader. Does not modify the map or its context. */
export async function installCanvasReadback(page) {
  await page.addInitScript(() => {
    window.readCanvasPixels = async canvas => {
      if (!canvas.width || !canvas.height) return new Uint8ClampedArray();
      const bitmap = await createImageBitmap(canvas);
      const copy = document.createElement('canvas');
      copy.width = bitmap.width; copy.height = bitmap.height;
      const context = copy.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0); bitmap.close();
      const data = context.getImageData(0, 0, copy.width, copy.height).data;
      copy.width = copy.height = 0;
      return data;
    };
  });
}
