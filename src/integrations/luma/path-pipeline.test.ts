import { describe, it, expect } from 'vitest';
import { useMsaaPath, opaquePathGroup } from './path-pipeline';
import type { MeshPaint } from './types';
const paint: MeshPaint = { color: [0.1, 0.3, 0.7, 1], width: 0.6 };
describe('full geometry MSAA path policy', () => {
  it('optimizes opaque solid strokes without a minimum pixel length or width', () => {
    expect(useMsaaPath(paint, 'auto', 4)).toBe(true);
    expect(useMsaaPath({ ...paint, width: 0.01 }, 'auto', 4)).toBe(true);
    expect(useMsaaPath(paint, 'reference', 4)).toBe(true);
  });
  it('retains analytic fallback for transparency, dashes, arrows or no multisampling', () => {
    for (const other of [
      { ...paint, color: [0, 0, 1, 0.5] as [number, number, number, number] },
      { ...paint, dash: [3, 2] },
      { ...paint, arrow: { size: 6, spacing: 32 } },
    ])
      expect(useMsaaPath(other, 'auto', 4)).toBe(false);
    expect(useMsaaPath(paint, 'auto', 1)).toBe(false);
    expect(useMsaaPath(paint, 'auto', 0)).toBe(false);
    expect(useMsaaPath(paint, 'legacy', 4)).toBe(false);
  });
  it('rejects invalid widths and only reuses depth for identical colors', () => {
    for (const width of [0, -1, NaN, Infinity])
      expect(useMsaaPath({ ...paint, width }, 'auto', 4)).toBe(false);
    expect(opaquePathGroup(paint)).toBe(opaquePathGroup({ ...paint, width: 10 }));
    expect(opaquePathGroup(paint)).not.toBe(opaquePathGroup({ ...paint, color: [1, 0, 0, 1] }));
  });
});
