import { describe, it, expect } from 'vitest';
import { validateRasterTextureRead } from './texture';
const level = {
  id: 0,
  width: 4096,
  height: 4096,
  tileWidth: 512,
  tileHeight: 512,
  decodedBlockConcurrency: 4,
  samples: 3,
  bits: [16, 16, 16],
  formats: [1, 1, 1],
  photometric: 2,
  subfileType: 0,
};
describe('texture output reservations', () => {
  it('accounts for packed output without changing raw read semantics', () => {
    expect(
      validateRasterTextureRead(level, { level: 0, window: [0, 0, 512, 512], samples: [0, 1, 2] }),
    ).toBeGreaterThan(512 * 512 * 8);
  });
  it.each([[2, 1, 0], [0], [0, 0, 2]])('rejects unsupported band layout %s', (samples) => {
    expect(() =>
      validateRasterTextureRead(level, { level: 0, window: [0, 0, 512, 512], samples }),
    ).toThrow();
  });
  it('rejects packed output over 8 MiB', () => {
    expect(() =>
      validateRasterTextureRead(level, {
        level: 0,
        window: [0, 0, 2048, 2048],
        samples: [0, 1, 2],
      }),
    ).toThrow();
  });
});
