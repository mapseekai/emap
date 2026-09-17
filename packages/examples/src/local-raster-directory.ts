export interface ReadableFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
}

export interface ReadableDirectoryHandle {
  readonly kind: 'directory';
  readonly name: string;
  entries(): AsyncIterableIterator<[string, ReadableFileHandle | ReadableDirectoryHandle]>;
  getFileHandle(name: string): Promise<ReadableFileHandle>;
}

export interface LocalRasterPair {
  readonly file: File;
  readonly overviewFile?: File;
}

export function isGeoTIFFFilename(name: string): boolean {
  return /\.(?:tif|tiff)$/i.test(name) && !/\.ovr$/i.test(name);
}

export function overviewFilename(name: string): string {
  return `${name}.ovr`;
}

export async function listGeoTIFFs(directory: ReadableDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === 'file' && isGeoTIFFFilename(name)) names.push(name);
  }
  return names.sort((a, b) => a.localeCompare(b));
}

export async function openRasterPair(
  directory: ReadableDirectoryHandle,
  filename: string,
): Promise<LocalRasterPair> {
  if (!isGeoTIFFFilename(filename)) throw new Error(`Not a GeoTIFF filename: ${filename}`);
  const file = await (await directory.getFileHandle(filename)).getFile();
  let overviewFile: File | undefined;
  try {
    overviewFile = await (await directory.getFileHandle(overviewFilename(filename))).getFile();
  } catch (error) {
    if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
  }
  return { file, overviewFile };
}
