import type { AffineTransform } from '../../geo/transform';

export interface WebGLFrameState {
  matrix: Float32Array;
  viewportSize: [number, number];
  pixelRatio: number;
  origin: [number, number];
}

export function makeFrameState(
  transform: AffineTransform,
  width: number,
  height: number,
  pixelRatio: number,
  origin: [number, number] = transform.unproject(0, 0),
): WebGLFrameState {
  const sx = 2 / (width || 1);
  const sy = -2 / (height || 1);
  return {
    matrix: new Float32Array([
      transform.mx * sx, 0, 0,
      0, transform.my * sy, 0,
      (transform.mx * origin[0] + transform.bx) * sx - 1,
      (transform.my * origin[1] + transform.by) * sy + 1,
      1,
    ]),
    viewportSize: [
      Math.floor(width * pixelRatio),
      Math.floor(height * pixelRatio),
    ],
    pixelRatio,
    origin,
  };
}
