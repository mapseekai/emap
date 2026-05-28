import { describe, expect, it } from 'vitest';
import { AffineTransform } from '../../geo/transform';
import { makeFrameState } from './frame';

describe('makeFrameState', () => {
  it('rebases clip matrix around the viewport origin for high zoom precision', () => {
    const transform = new AffineTransform(
      4096,
      -4096,
      -4096 * 1_000_000,
      4096 * 2_000_000,
    );

    const frame = makeFrameState(transform, 800, 600, 2);
    const localX = 0.25;
    const localY = -0.5;
    const projectedX = frame.matrix[0] * localX + frame.matrix[6];
    const projectedY = frame.matrix[4] * localY + frame.matrix[7];
    const screenX = transform.mx * (frame.origin[0] + localX) + transform.bx;
    const screenY = transform.my * (frame.origin[1] + localY) + transform.by;

    expect(frame.origin).toEqual([1_000_000, 2_000_000]);
    expect(frame.matrix[6]).toBeCloseTo(-1);
    expect(frame.matrix[7]).toBeCloseTo(1);
    expect(projectedX).toBeCloseTo(screenX * 2 / 800 - 1);
    expect(projectedY).toBeCloseTo(screenY * -2 / 600 + 1);
  });
});
