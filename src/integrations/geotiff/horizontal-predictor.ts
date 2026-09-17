export interface HorizontalPredictorParameters {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly planarConfiguration: number;
  readonly bitsPerSample: readonly number[];
  readonly predictor: number;
}

/** Reverse TIFF horizontal predictor 2 for byte-aligned integer samples. */
export function applyHorizontalPredictor(
  block: ArrayBuffer,
  parameters: HorizontalPredictorParameters,
): ArrayBuffer {
  if (parameters.predictor === 1) return block;
  if (parameters.predictor !== 2)
    throw new Error(`Unsupported TIFF predictor ${parameters.predictor}.`);
  const bits = parameters.bitsPerSample[0],
    bytesPerSample = bits / 8,
    stride = parameters.planarConfiguration === 2 ? 1 : parameters.bitsPerSample.length,
    rowBytes = parameters.tileWidth * stride * bytesPerSample;
  for (let row = 0; row < parameters.tileHeight; row++) {
    const offset = row * rowBytes;
    if (offset >= block.byteLength) break;
    const bytes = Math.min(rowBytes, block.byteLength - offset);
    if (bits === 8) {
      const values = new Uint8Array(block, offset, bytes);
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    } else if (bits === 16) {
      const values = new Uint16Array(block, offset, Math.floor(bytes / 2));
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    } else if (bits === 32) {
      const values = new Uint32Array(block, offset, Math.floor(bytes / 4));
      for (let i = stride; i < values.length; i++) values[i] += values[i - stride];
    } else throw new Error(`Predictor 2 not allowed with ${bits} bits per sample.`);
  }
  return block;
}
