import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { decodeFont } from './woff';
describe('WOFF bounds and SFNT consistency', () => {
  it('decodes the shipped OFL WOFF1 and returns SFNT unchanged', async () => {
    const font = decodeFont(
      new Uint8Array(
        await readFile(
          'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff',
        ),
      ),
    );
    expect([0x10000, 0x4f54544f]).toContain(new DataView(font.buffer).getUint32(0));
    expect(decodeFont(font)).toBe(font);
  });
  it('rejects WOFF2, truncated tables and expansion beyond budget before decompression', async () => {
    const source = new Uint8Array(
      await readFile(
        'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff',
      ),
    );
    const woff2 = source.slice();
    new DataView(woff2.buffer).setUint32(0, 0x774f4632);
    expect(() => decodeFont(woff2)).toThrow('WOFF2');
    expect(() => decodeFont(source.slice(0, -1))).toThrow('Truncated');
    const huge = source.slice();
    new DataView(huge.buffer).setUint32(16, 0xffffffff);
    expect(() => decodeFont(huge)).toThrow('directory');
    const table = source.slice();
    new DataView(table.buffer).setUint32(48, 0xffffffff);
    expect(() => decodeFont(table)).toThrow('bounds');
  });
});
