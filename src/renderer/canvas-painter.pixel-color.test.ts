import { describe, it, expect } from 'vitest';

(globalThis as any).window = { devicePixelRatio: 1 };

import { getPixelColorFunction } from './canvas-painter';

// Build a fake 1x1 ctx whose getImageData encodes the assigned fillStyle into
// pixel bytes. Lets us exercise getPixelColorFunction without a real DOM.
function makeFakeCtx() {
  // Lookup table mapping our test fill styles → expected uint8 RGBA bytes
  const styleToBytes: Record<string, [number, number, number, number]> = {
    '#000': [0, 0, 0, 255],
    '#ff0000': [255, 0, 0, 255],
    'red': [255, 0, 0, 255],
    'blue': [0, 0, 255, 255],
    'rgba(255, 0, 0, 1)': [255, 0, 0, 255],
    'rgba(0, 0, 0, 1)': [0, 0, 0, 255],
  };
  let current: [number, number, number, number] = [0, 0, 0, 0];
  let parseCalls = 0;
  const ctx: any = {
    set fillStyle(v: string) {
      parseCalls++;
      current = styleToBytes[v] ?? [0, 0, 0, 0];
    },
    clearRect() {},
    fillRect() {},
    getImageData() {
      const data = new Uint8ClampedArray([...current]);
      return { data };
    },
  };
  return {
    ctx,
    getParseCalls: () => parseCalls,
  };
}

describe('getPixelColorFunction — color memoization', () => {
  it('returns same uint32 for repeated input', () => {
    const { ctx } = makeFakeCtx();
    const fn = getPixelColorFunction(ctx);
    const a = fn('rgba(255, 0, 0, 1)');
    const b = fn('rgba(255, 0, 0, 1)');
    expect(typeof a).toBe('number');
    expect(a).toBe(b);
  });

  it('cache: parses each unique input exactly once', () => {
    const { ctx, getParseCalls } = makeFakeCtx();
    const fn = getPixelColorFunction(ctx);
    fn('red');
    fn('red');
    fn('blue');
    fn('blue');
    fn('red');
    // 'red' parsed once, 'blue' parsed once → 2 fillStyle assignments
    expect(getParseCalls()).toBe(2);
  });

  it('opaque colors yield non-zero high byte (alpha)', () => {
    const { ctx } = makeFakeCtx();
    const fn = getPixelColorFunction(ctx);
    const v = fn('rgba(0, 0, 0, 1)');
    // Little-endian: alpha occupies the high byte of the uint32
    expect((v >>> 24) & 0xff).toBe(255);
  });
});
