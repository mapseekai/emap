import { describe, expect, it } from 'vitest';
import { intersectingContours, tessellateEvenOdd } from './polygon-tessellation';

describe('even-odd display tessellation', () => {
  it('keeps simple contours on the existing path and detects nonadjacent touches and crossings', () => {
    expect(intersectingContours([[0, 0, 4, 0, 4, 4, 0, 4, 0, 0]])).toBe(false);
    expect(
      intersectingContours([
        [0, 0, 4, 0, 4, 4, 0, 4],
        [1, 1, 2, 1, 2, 2, 1, 2],
      ]),
    ).toBe(false);
    expect(intersectingContours([[0, 0, 4, 4, 0, 4, 4, 0]])).toBe(true);
    expect(intersectingContours([[0, 0, 4, 0, 4, 4, 2, 0, 0, 4]])).toBe(true);
    expect(
      intersectingContours([
        [0, 0, 4, 0, 4, 4, 0, 4],
        [0, 0, 4, 0, 4, 4, 0, 4],
      ]),
    ).toBe(true);
  });

  it('matches independent ray parity for intersecting contours regardless of winding', () => {
    let seed = 32;
    const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    for (let k = 0; k < 40; k++) {
      const contour = Array.from({ length: 12 }, () => random() * 10);
      const contours = [contour, [3, 3, 7, 3, 7, 7, 3, 7]];
      const { positions, indices } = tessellateEvenOdd(contours);
      for (let x = 0.173; x < 10; x += 0.7)
        for (let y = 0.231; y < 10; y += 0.7) {
          let parity = false;
          for (const ring of contours)
            for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
              if (
                ring[i + 1] > y !== ring[j + 1] > y &&
                x <
                  ((ring[j] - ring[i]) * (y - ring[i + 1])) / (ring[j + 1] - ring[i + 1]) + ring[i]
              )
                parity = !parity;
            }
          let covered = false;
          for (let i = 0; i < indices.length; i += 3) {
            const signs = [0, 1, 2].map((j) => {
              const a = positions[indices[i + j]],
                b = positions[indices[i + ((j + 1) % 3)]];
              return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
            });
            if (signs.every((v) => v >= 0) || signs.every((v) => v <= 0)) covered = true;
          }
          expect(covered).toBe(parity);
        }
    }
  });

  it('detects crossings through the spatial path used for long contours', () => {
    const ring = Array.from({ length: 128 }, (_, i) => {
      const angle = (i * Math.PI * 2) / 128;
      return [Math.cos(angle), Math.sin(angle)];
    });
    expect(intersectingContours([ring.flat()])).toBe(false);
    [ring[12], ring[70]] = [ring[70], ring[12]];
    expect(intersectingContours([ring.flat()])).toBe(true);
  });
});
