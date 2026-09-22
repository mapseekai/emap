import { describe, it, expect } from 'vitest';
import { rasterFileSelections } from '../../packages/examples/src/luma-raster/files';
function file(path: string) {
  const f = new File(['x'], path.split('/').at(-1)!);
  Object.defineProperty(f, 'webkitRelativePath', { value: path });
  return f;
}
describe('local raster folder pairing', () => {
  it('pairs OVR by full relative path and ignores TFW/XML', () => {
    const a = file('a/one.tif'),
      b = file('b/one.tif'),
      ovr = file('a/one.tif.ovr');
    const rows = rasterFileSelections([a, b, ovr, file('a/one.tfw'), file('a/one.tif.aux.xml')]);
    expect(rows).toHaveLength(2);
    expect(rows[0].overview).toBe(ovr);
    expect(rows[1].overview).toBeUndefined();
  });
  it('supports flat file selections and case-insensitive sidecars', () => {
    expect(
      rasterFileSelections([new File(['x'], 'A.TIF'), new File(['x'], 'a.tif.OVR')])[0].overview,
    ).toBeDefined();
  });
  it('rejects ambiguous duplicate paths', () => {
    expect(() => rasterFileSelections([file('a.tif'), file('a.TIF')])).toThrow();
  });
});
