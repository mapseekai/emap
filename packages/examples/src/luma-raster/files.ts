/** Resolve selected local files by relative path, never by basename alone.
 * Sidecars stay File references; TFW/XML are not read when GeoTIFF has georeferencing. */
export interface RasterFileSelection {
  readonly file: File;
  readonly overview?: File;
  readonly path: string;
}
export function rasterFileSelections(files: readonly File[]): readonly RasterFileSelection[] {
  const path = (f: File) => (f.webkitRelativePath || f.name).replace(/\\/g, '/');
  const index = new Map<string, File>();
  for (const file of files) {
    const key = path(file).toLowerCase();
    if (!/\.(tiff?|ovr)$/i.test(key) || /(^|\/)\._/.test(key)) continue;
    if (index.has(key)) throw new Error(`Duplicate raster path: ${path(file)}`);
    index.set(key, file);
  }
  return [...index]
    .filter(([key]) => /\.tiff?$/i.test(key))
    .map(([key, file]) => ({ file, path: path(file), overview: index.get(`${key}.ovr`) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}
