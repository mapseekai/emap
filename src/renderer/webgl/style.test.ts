import { describe, expect, it } from 'vitest';
import {
  parseColor,
  resolvePointUniforms,
  resolveStrokeUniforms,
} from './style';

describe('webgl style helpers', () => {
  it('parses hex colors into normalized rgba', () => {
    expect(parseColor('#336699')).toEqual([
      0x33 / 255,
      0x66 / 255,
      0x99 / 255,
      1,
    ]);
  });

  it('parses shorthand hex colors into normalized rgba', () => {
    expect(parseColor('#369')).toEqual([
      0x33 / 255,
      0x66 / 255,
      0x99 / 255,
      1,
    ]);
  });

  it('parses rgba colors and multiplies opacity', () => {
    const color = parseColor('rgba(100, 50, 25, 0.8)', 0.5);
    expect(color[0]).toBeCloseTo(100 / 255);
    expect(color[1]).toBeCloseTo(50 / 255);
    expect(color[2]).toBeCloseTo(25 / 255);
    expect(color[3]).toBeCloseTo(0.4);
  });

  it('scales stroke width and point radius by pixel ratio', () => {
    expect(resolveStrokeUniforms({ color: '#000', width: 2 }, 3)).toEqual({
      color: [0, 0, 0, 1],
      width: 6,
    });
    expect(resolvePointUniforms({ color: '#000', radius: 4 }, 2)).toEqual({
      color: [0, 0, 0, 1],
      radius: 8,
      fill: true,
    });
  });
});
