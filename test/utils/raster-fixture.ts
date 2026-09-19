import { encodeTiffLzw } from './tiff-lzw';
import { deflateSync } from 'node:zlib';
/** Small, deterministic TIFF fixtures; no network or GDAL dependency. */
export interface RasterFixtureOptions {
  compression?: 'deflate' | 'deflate-old' | 'lzw';
  width?: number;
  height?: number;
  overviews?: number[];
  bigTiff?: boolean;
  epsg?: number | null;
  subfileType?: number;
  mask?: boolean;
  pixelIsPoint?: boolean;
  scaleFactor?: number;
  bits?: 8 | 16 | 32 | 64;
  sampleFormat?: 1 | 2 | 3;
  pixelValue?: (x: number, y: number, band: number) => number;
  bands?: 1 | 3 | 4;
  noData?: number;
  subIfd?: boolean;
  photometric?: number;
  extraSamples?: number[];
}
function float16Bits(value: number): number {
  const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
  const v = Math.abs(value);
  if (Number.isNaN(v)) return sign | 0x7e00;
  if (!Number.isFinite(v) || v >= 65520) return sign | 0x7c00;
  if (v === 0) return sign;
  if (v < 2 ** -14) return sign | Math.round(v / 2 ** -24);
  let exponent = Math.floor(Math.log2(v));
  let fraction = Math.round((v / 2 ** exponent - 1) * 1024);
  if (fraction === 1024) {
    fraction = 0;
    exponent++;
  }
  return sign | ((exponent + 15) << 10) | fraction;
}
export function makeRasterFixture(options: RasterFixtureOptions = {}): Uint8Array {
  const width = options.width ?? 8,
    height = options.height ?? 8,
    big = options.bigTiff ?? false;
  const bits = options.bits ?? 8,
    bands = options.bands ?? 3;
  const factors = [1, ...(options.overviews ?? []), ...(options.mask ? [2] : [])];
  type Tag = { id: number; type: number; values: number[]; offset?: number };
  const header = big ? 16 : 8,
    countSize = big ? 8 : 2,
    entrySize = big ? 20 : 12,
    pointerSize = big ? 8 : 4;
  const sizes: Record<number, number> = { 2: 1, 3: 2, 4: 4, 12: 8, 16: 8, 18: 8 };
  const images = factors.map((factor, index) => {
    const w = Math.ceil(width / factor),
      h = Math.ceil(height / factor);
    const mask = options.mask && index === factors.length - 1;
    const samples = mask ? 1 : bands,
      depth = mask ? 8 : bits;
    const format = mask ? 1 : (options.sampleFormat ?? 1);
    const values = new Uint8Array(w * h * samples * (depth / 8));
    const pixels = new DataView(values.buffer);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let b = 0; b < samples; b++) {
          const value =
            options.pixelValue?.(x * factor, y * factor, b) ??
            (b === 0
              ? 180
              : b === 1
                ? Math.round((255 * x) / Math.max(1, w - 1))
                : Math.round((255 * y) / Math.max(1, h - 1)));
          const pos = ((y * w + x) * samples + b) * (depth / 8);
          const sample = options.pixelValue ? value : depth === 8 ? value : value * 100;
          if (format === 3) {
            if (depth === 16) pixels.setUint16(pos, float16Bits(sample), true);
            else if (depth === 32) pixels.setFloat32(pos, sample, true);
            else pixels.setFloat64(pos, sample, true);
          } else if (format === 2) {
            if (depth === 8) pixels.setInt8(pos, sample);
            else if (depth === 16) pixels.setInt16(pos, sample, true);
            else pixels.setInt32(pos, sample, true);
          } else {
            if (depth === 8) pixels.setUint8(pos, sample);
            else if (depth === 16) pixels.setUint16(pos, sample, true);
            else pixels.setUint32(pos, sample, true);
          }
        }
    const deflate = options.compression === 'deflate' || options.compression === 'deflate-old';
    const payload =
      options.compression === 'lzw'
        ? encodeTiffLzw(values)
        : deflate
          ? new Uint8Array(deflateSync(values))
          : values;
    const tags: Tag[] = [
      { id: 254, type: 4, values: [mask ? 5 : index > 0 ? 1 : (options.subfileType ?? 0)] },
      { id: 256, type: 4, values: [w] },
      { id: 257, type: 4, values: [h] },
      { id: 258, type: 3, values: Array(samples).fill(depth) },
      {
        id: 259,
        type: 3,
        values: [
          options.compression === 'lzw'
            ? 5
            : options.compression === 'deflate-old'
              ? 32946
              : deflate
                ? 8
                : 1,
        ],
      },
      { id: 262, type: 3, values: [options.photometric ?? (samples >= 3 ? 2 : 1)] },
      { id: 273, type: big ? 16 : 4, values: [0] },
      { id: 277, type: 3, values: [samples] },
      { id: 278, type: 4, values: [h] },
      { id: 279, type: big ? 16 : 4, values: [payload.length] },
      { id: 284, type: 3, values: [1] },
      { id: 339, type: 3, values: Array(samples).fill(format) },
      {
        id: 33550,
        type: 12,
        values: [
          factor * (options.scaleFactor ?? 1) * 0.01,
          factor * (options.scaleFactor ?? 1) * 0.01,
          0,
        ],
      },
      { id: 33922, type: 12, values: [0, 0, 0, 116, 40, 0] },
    ];
    if (options.extraSamples) tags.push({ id: 338, type: 3, values: options.extraSamples });
    else if (samples === 4) tags.push({ id: 338, type: 3, values: [2] });
    if (options.epsg !== null)
      tags.push({
        id: 34735,
        type: 3,
        values: [
          1,
          1,
          0,
          3,
          1024,
          0,
          1,
          2,
          1025,
          0,
          1,
          options.pixelIsPoint ? 2 : 1,
          2048,
          0,
          1,
          options.epsg ?? 4326,
        ],
      });
    if (options.noData !== undefined)
      tags.push({
        id: 42113,
        type: 2,
        values: [...`${options.noData}\0`].map((c) => c.charCodeAt(0)),
      });
    if (index === 0 && options.subIfd) tags.push({ id: 330, type: big ? 18 : 4, values: [0] });
    tags.sort((a, b) => a.id - b.id);
    return { tags, values: payload, offset: 0, pixelOffset: 0 };
  });
  let cursor = header;
  for (const image of images) {
    image.offset = cursor;
    cursor += countSize + image.tags.length * entrySize + pointerSize;
  }
  if (options.subIfd) images[0].tags.find((t) => t.id === 330)!.values = [images[1].offset];
  for (const image of images)
    for (const tag of image.tags) {
      if (tag.values.length * sizes[tag.type] > pointerSize) {
        tag.offset = cursor;
        cursor += tag.values.length * sizes[tag.type];
      }
    }
  for (const image of images) {
    image.pixelOffset = cursor;
    cursor += image.values.length;
    image.tags.find((t) => t.id === 273)!.values = [image.pixelOffset];
  }
  const bytes = new Uint8Array(cursor),
    view = new DataView(bytes.buffer);
  view.setUint16(0, 0x4949, true);
  view.setUint16(2, big ? 43 : 42, true);
  const pointer = (pos: number, value: number) => {
    if (big) view.setBigUint64(pos, BigInt(value), true);
    else view.setUint32(pos, value, true);
  };
  if (big) {
    view.setUint16(4, 8, true);
    view.setUint16(6, 0, true);
  }
  pointer(big ? 8 : 4, header);
  const write = (pos: number, type: number, value: number) => {
    if (type === 2) view.setUint8(pos, value);
    else if (type === 3) view.setUint16(pos, value, true);
    else if (type === 4) view.setUint32(pos, value, true);
    else if (type === 12) view.setFloat64(pos, value, true);
    else view.setBigUint64(pos, BigInt(value), true);
  };
  images.forEach((image, index) => {
    if (big) view.setBigUint64(image.offset, BigInt(image.tags.length), true);
    else view.setUint16(image.offset, image.tags.length, true);
    image.tags.forEach((tag, i) => {
      const pos = image.offset + countSize + i * entrySize;
      view.setUint16(pos, tag.id, true);
      view.setUint16(pos + 2, tag.type, true);
      if (big) view.setBigUint64(pos + 4, BigInt(tag.values.length), true);
      else view.setUint32(pos + 4, tag.values.length, true);
      const payload = pos + (big ? 12 : 8);
      if (tag.offset !== undefined) pointer(payload, tag.offset);
      tag.values.forEach((value, j) =>
        write((tag.offset ?? payload) + j * sizes[tag.type], tag.type, value),
      );
    });
    pointer(
      image.offset + countSize + image.tags.length * entrySize,
      options.subIfd && index === 0 ? 0 : (images[index + 1]?.offset ?? 0),
    );
    bytes.set(image.values, image.pixelOffset);
  });
  return bytes;
}
