import { describe, expect, it } from 'vitest';
import {
  isGeoTIFFFilename,
  listGeoTIFFs,
  openRasterPair,
  overviewFilename,
} from './local-raster-directory';

function directory(files: Record<string, File>) {
  const handles = new Map(
    Object.entries(files).map(([name, file]) => [
      name,
      {
        kind: 'file' as const,
        name,
        getFile: async () => file,
      },
    ]),
  );
  return {
    kind: 'directory' as const,
    name: 'imagery',
    async *entries() {
      for (const entry of handles) yield entry;
    },
    async getFileHandle(name: string) {
      const handle = handles.get(name);
      if (!handle) throw new DOMException('Not found', 'NotFoundError');
      return handle;
    },
  };
}

describe('local raster directory helpers', () => {
  it('recognizes TIFF names and derives the conventional external overview name', () => {
    expect(isGeoTIFFFilename('a.tif')).toBe(true);
    expect(isGeoTIFFFilename('A.TIFF')).toBe(true);
    expect(isGeoTIFFFilename('a.tif.ovr')).toBe(false);
    expect(overviewFilename('a.tif')).toBe('a.tif.ovr');
  });
  it('lists only raster sources and opens a same-directory .ovr companion automatically', async () => {
    const dir = directory({
      'b.tiff': new File(['b'], 'b.tiff'),
      'a.tif': new File(['a'], 'a.tif'),
      'a.tif.ovr': new File(['ovr'], 'a.tif.ovr'),
      'notes.txt': new File(['x'], 'notes.txt'),
    });
    expect(await listGeoTIFFs(dir)).toEqual(['a.tif', 'b.tiff']);
    const pair = await openRasterPair(dir, 'a.tif');
    expect(pair.file.name).toBe('a.tif');
    expect(pair.overviewFile?.name).toBe('a.tif.ovr');
    expect((await openRasterPair(dir, 'b.tiff')).overviewFile).toBeUndefined();
  });
});
