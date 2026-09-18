import { RasterError } from '../../domain/raster/policy';

type Slice = { offset: number; length: number };
/** A geotiff.js range source backed by the original Blob. No full-file arrayBuffer(). */
export class LocalRasterFileSource {
  private bytes = 0;
  private cumulativeLimit = 32 * 1024 ** 2;
  private singleRangeLimit = 32 * 1024 ** 2;
  private closed = false;
  private cacheEnabled = false;
  private readonly pages = new Map<number, ArrayBuffer>();
  private readonly pendingPages = new Map<number, Promise<ArrayBuffer>>();
  private readonly pageSize = 64 * 1024;
  // Replicas divide this capacity instead of multiplying retained compressed pages.
  private readonly pageLimit: number;
  private readMs = 0;
  private readOps = 0;
  private readBytesTotal = 0;
  private pageHits = 0;
  private pageMisses = 0;
  readonly fileSize: number;
  constructor(
    private file: Blob | null,
    pageLimit = 16,
  ) {
    if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 16)
      throw new RasterError('INVALID_RASTER_BUDGET', 'Page count must be 1–16.');
    this.pageLimit = pageLimit;
    if (!file) throw new RasterError('INVALID_RASTER', 'Missing local raster file.');
    this.fileSize = file.size;
  }
  getDiagnostics(): {
    readMs: number;
    readOps: number;
    readBytes: number;
    pageHits: number;
    pageMisses: number;
  } {
    return {
      readMs: this.readMs,
      readOps: this.readOps,
      readBytes: this.readBytesTotal,
      pageHits: this.pageHits,
      pageMisses: this.pageMisses,
    };
  }
  beginRead(cumulativeLimit = 64 * 1024 ** 2): void {
    if (
      !Number.isSafeInteger(cumulativeLimit) ||
      cumulativeLimit < 64 * 1024 ** 2 ||
      cumulativeLimit > 256 * 1024 ** 2
    )
      throw new RasterError('INVALID_RASTER_BUDGET', 'Read budget must be 64–256MiB.');
    this.bytes = 0;
    this.cumulativeLimit = cumulativeLimit;
    this.singleRangeLimit = 64 * 1024 ** 2;
    this.cacheEnabled = true;
  }
  async fetch(slices: Slice[], signal?: AbortSignal): Promise<ArrayBuffer[]> {
    const output: ArrayBuffer[] = [];
    // Deliberately sequential: Promise.all on untrusted ranges can multiply peak memory.
    for (const slice of slices) output.push((await this.fetchSlice(slice, signal)).data);
    return output;
  }
  async fetchSlice(slice: Slice, signal?: AbortSignal): Promise<Slice & { data: ArrayBuffer }> {
    signal?.throwIfAborted();
    const file = this.file;
    if (this.closed || !file)
      throw new RasterError('SOURCE_CLOSED', 'Raster file source has been closed.');
    const { offset, length } = slice;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset >= this.fileSize ||
      !Number.isSafeInteger(offset + length)
    ) {
      throw new RasterError('INVALID_TIFF_OFFSET', 'Invalid or unsafe TIFF byte range.');
    }
    if (length > this.singleRangeLimit)
      throw new RasterError(
        'RASTER_IO_BUDGET',
        'Requested TIFF byte range exceeds the read budget.',
      );
    let data: ArrayBuffer;
    if (this.cacheEnabled && length <= this.pageSize * 2 && length > 0) {
      const end = Math.min(offset + length, this.fileSize);
      const parts: { data: ArrayBuffer; start: number; end: number }[] = [];
      for (let position = offset; position < end; ) {
        signal?.throwIfAborted();
        const page = Math.floor(position / this.pageSize) * this.pageSize;
        const bytes = await this.readPage(page, signal);
        const start = position - page,
          stop = Math.min(bytes.byteLength, end - page);
        if (stop <= start)
          throw new RasterError(
            'TRUNCATED_TIFF_RANGE',
            'TIFF range ended before the requested bytes.',
          );
        parts.push({ data: bytes, start, end: stop });
        position = page + stop;
      }
      const output = new Uint8Array(end - offset);
      let target = 0;
      for (const part of parts) {
        output.set(new Uint8Array(part.data, part.start, part.end - part.start), target);
        target += part.end - part.start;
      }
      data = output.buffer;
    } else data = await this.readBytes(offset, length);
    signal?.throwIfAborted();
    if (this.closed) throw new RasterError('SOURCE_CLOSED', 'Raster file source has been closed.');
    return { ...slice, data };
  }
  private async readBytes(offset: number, length: number): Promise<ArrayBuffer> {
    const file = this.file;
    if (this.closed || !file)
      throw new RasterError('SOURCE_CLOSED', 'Raster source has been closed.');
    this.bytes += Math.min(length, this.fileSize - offset);
    if (this.bytes > this.cumulativeLimit)
      throw new RasterError(
        'RASTER_IO_BUDGET',
        'TIFF physical range reads exceed the bounded I/O budget.',
      );
    const started = performance.now();
    const bytes = await file.slice(offset, offset + length).arrayBuffer();
    this.readMs += performance.now() - started;
    this.readOps++;
    this.readBytesTotal += bytes.byteLength;
    if (this.closed) throw new RasterError('SOURCE_CLOSED', 'Raster source has been closed.');
    return bytes;
  }
  private async readPage(offset: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    signal?.throwIfAborted();
    const cached = this.pages.get(offset);
    if (cached) {
      this.pageHits++;
      this.pages.delete(offset);
      this.pages.set(offset, cached);
      return cached;
    }
    const pending = this.pendingPages.get(offset);
    if (pending) {
      this.pageHits++;
      return pending;
    }
    if (this.pendingPages.size >= this.pageLimit) {
      await Promise.race(this.pendingPages.values());
      return this.readPage(offset, signal);
    }
    this.pageMisses++;
    const request = this.readBytes(offset, this.pageSize);
    this.pendingPages.set(offset, request);
    try {
      const bytes = await request;
      if (!this.closed) {
        this.pages.set(offset, bytes);
        while (this.pages.size > this.pageLimit) this.pages.delete(this.pages.keys().next().value!);
      }
      return bytes;
    } finally {
      if (this.pendingPages.get(offset) === request) this.pendingPages.delete(offset);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.file = null;
    this.pages.clear();
    this.pendingPages.clear();
  }
}

const FIELD_BYTES: Readonly<Record<number, number>> = {
  1: 1,
  2: 1,
  3: 2,
  4: 4,
  5: 8,
  6: 1,
  7: 1,
  8: 2,
  9: 4,
  10: 8,
  11: 4,
  12: 8,
  13: 4,
  16: 8,
  17: 8,
  18: 8,
};
/** Guard directory counts BEFORE geotiff.js allocates eager or deferred tag arrays. */
export async function validateTiffDirectory(
  source: LocalRasterFileSource,
  offset: number,
  littleEndian: boolean,
  bigTiff: boolean,
  signal?: AbortSignal,
): Promise<number> {
  const headSize = bigTiff ? 8 : 2;
  const [head] = await source.fetch([{ offset, length: headSize }], signal);
  const view = new DataView(head);
  const count = bigTiff
    ? Number(view.getBigUint64(0, littleEndian))
    : view.getUint16(0, littleEndian);
  if (!Number.isSafeInteger(count) || count > 4096)
    throw new RasterError('TIFF_DIRECTORY_BUDGET', 'Too many TIFF directory entries.');
  const entrySize = bigTiff ? 20 : 12;
  const [bytes] = await source.fetch(
    [{ offset: offset + headSize, length: count * entrySize + (bigTiff ? 8 : 4) }],
    signal,
  );
  const entries = new DataView(bytes);
  let total = 0;
  for (let i = 0; i < count; i++) {
    const pos = i * entrySize;
    const type = entries.getUint16(pos + 2, littleEndian);
    const items = bigTiff
      ? Number(entries.getBigUint64(pos + 4, littleEndian))
      : entries.getUint32(pos + 4, littleEndian);
    const size = FIELD_BYTES[type];
    if (!size || !Number.isSafeInteger(items) || items > 2 * 1024 ** 2)
      throw new RasterError(
        'TIFF_DIRECTORY_BUDGET',
        'Unsupported TIFF field type or excessive tag array length.',
      );
    const length = items * size;
    total += length;
    if (total > 32 * 1024 ** 2)
      throw new RasterError('TIFF_DIRECTORY_BUDGET', 'TIFF directory arrays exceed 32MiB.');
    if (length > (bigTiff ? 8 : 4)) {
      const pointer = bigTiff
        ? Number(entries.getBigUint64(pos + 12, littleEndian))
        : entries.getUint32(pos + 8, littleEndian);
      if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer + length > source.fileSize)
        throw new RasterError('INVALID_TIFF_OFFSET', 'TIFF tag points outside the original file.');
    }
  }
  return total;
}
