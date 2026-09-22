import type { RasterReadResult, RasterWindow } from '../../domain/raster/types';

/** Pack a texture subwindow from shared planar source data without allocating
 * intermediate cropped planes. Missing GPU channels are zero, not invented alpha. */
export function packRasterWindow(
  result: RasterReadResult,
  readWindow: RasterWindow,
  window: RasterWindow,
  storage?: Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> | Uint16Array<ArrayBuffer> {
  const { width: stride, height, data } = result;
  const byte = data[0] instanceof Uint8Array;
  const width = window[2] - window[0],
    rows = window[3] - window[1];
  if (
    ![...readWindow, ...window].every(Number.isSafeInteger) ||
    width < 1 ||
    rows < 1 ||
    width * rows > 4 * 1024 ** 2 ||
    stride !== readWindow[2] - readWindow[0] ||
    height !== readWindow[3] - readWindow[1] ||
    window[0] < readWindow[0] ||
    window[1] < readWindow[1] ||
    window[2] > readWindow[2] ||
    window[3] > readWindow[3] ||
    data.length < 1 ||
    data.length > 4 ||
    data.some(
      (a) =>
        !(byte ? a instanceof Uint8Array : a instanceof Uint16Array) ||
        a.length !== stride * height,
    )
  )
    throw new Error('Invalid UInt16 texture subwindow.');
  if (
    storage &&
    (!(byte ? storage instanceof Uint8Array : storage instanceof Uint16Array) ||
      storage.length !== width * rows * 4 ||
      data.some((a) => a.buffer === storage.buffer))
  )
    throw new Error('Packing storage must fit the texture and must not alias original samples.');
  const out =
    storage ?? (byte ? new Uint8Array(width * rows * 4) : new Uint16Array(width * rows * 4));
  const [r, g, b, a] = data;
  let source = (window[1] - readWindow[1]) * stride + window[0] - readWindow[0],
    target = 0;
  // Hoist channel selection and avoid the former inner dynamic band loop.
  for (let row = 0; row < rows; row++, source += stride) {
    for (let x = 0; x < width; x++, target += 4) {
      const i = source + x;
      out[target] = r[i];
      out[target + 1] = g ? g[i] : 0;
      out[target + 2] = b ? b[i] : 0;
      out[target + 3] = a ? a[i] : 0;
    }
  }
  return out;
}
