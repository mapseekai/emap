import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import createHarfBuzz from 'harfbuzzjs/hb.js';
import bindHarfBuzz from 'harfbuzzjs/hbjs.js';
import { MsdfGenerator } from '../src/integrations/msdf/generator.ts';
import { decodeFont } from '../src/integrations/msdf/woff.ts';
import {
  GLYPHS_PER_SHARD,
  GLYPH_RANGES,
  PACK_HEADER_LIMIT,
  shardPath,
} from '../src/integrations/msdf/protocol.ts';
import { MAX_MSDF_BYTES } from '../src/integrations/msdf/resource.ts';

async function publish(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tmp, data, { flag: 'wx' });
    await rename(tmp, path);
  } finally {
    await rm(tmp, { force: true });
  }
}

// Planar horizontal deltas compress losslessly; the shader's alpha is always 255.
function encodeRGB({ data, width, height }) {
  const area = width * height,
    out = Buffer.allocUnsafe(area * 3);
  for (let channel = 0; channel < 3; channel++)
    for (let i = 0; i < area; i++)
      out[channel * area + i] =
        data[i * 4 + channel] - (i % width ? data[(i - 1) * 4 + channel] : 0);
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      family: { type: 'string', multiple: true },
      weight: { type: 'string', multiple: true },
      range: { type: 'string', multiple: true },
      font: { type: 'string' },
      help: { type: 'boolean' },
    },
  });
  const usage =
    'emap-glyph-pack OUTPUT_DIR [--family sans-serif|serif|monospace] [--weight 400|700] [--range 32|64|128|256] [--font FILE.ttf|otf|woff]';
  if (values.help) return console.log(usage);
  const families = values.family ?? (values.font ? [] : ['sans-serif']),
    weights = values.weight ?? ['400'];
  const ranges = [...new Set((values.range ?? ['32']).map(Number))].sort((a, b) => a - b);
  if (
    positionals.length !== 1 ||
    families.some((f) => !['sans-serif', 'serif', 'monospace'].includes(f)) ||
    weights.some((w) => !['400', '700'].includes(w)) ||
    ranges.some((r) => !GLYPH_RANGES.includes(r))
  )
    throw new Error(usage);

  const dir = resolve(positionals[0]),
    sdk = join(__dirname, 'msdf');
  const assets = (await readFile(join(sdk, 'assets.sha256'), 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(assets)) throw new Error('Invalid eMAP font assets fingerprint.');
  const faces = new Map(),
    licenses = new Set();
  const fonts = JSON.parse(await readFile(join(sdk, 'fonts.json'), 'utf8'));
  // Include the physical faces used by the shaper's fallback chain.
  for (const family of new Set(families.length ? [...families, 'sans-serif'] : []))
    for (const weight of weights)
      for (const { url } of fonts[`${family}:${weight}`]) {
        faces.set(url, join(sdk, url));
        licenses.add(
          basename(url).match(/^noto-(?:sans-sc|serif-sc|sans-mono)/)[0] + '-LICENSE.txt',
        );
      }
  const catalog = { version: 2, assets, ranges, faces: {} };
  if (values.font) {
    const bytes = await readFile(values.font);
    decodeFont(bytes); // Validate the format before publishing it for shaping.
    const ext = { 0x774f4646: 'woff', 0x4f54544f: 'otf', 0x00010000: 'ttf' }[bytes.readUInt32BE(0)];
    const name = 'font-' + createHash('sha256').update(bytes).digest('hex') + '.' + ext;
    await publish(join(dir, name), bytes);
    faces.set(name, join(dir, name));
    catalog.defaultFont = {
      face: name,
      family: families[0] ?? 'sans-serif',
      weight: Number(weights[0]),
    };
  }
  const hb = bindHarfBuzz(
    await createHarfBuzz({ wasmBinary: await readFile(join(sdk, 'hb.wasm')) }),
  );
  const generator = await MsdfGenerator.create(await readFile(join(sdk, 'msdfgen.wasm')));
  let bitmaps = 0,
    shards = 0,
    totalBytes = 0;
  try {
    for (const [name, source] of faces) {
      const bytes = decodeFont(new Uint8Array(await readFile(source)));
      const blob = hb.createBlob(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      const face = hb.createFace(blob, 0),
        font = hb.createFont(face);
      try {
        const maxp = face.reference_table('maxp');
        if (!maxp || maxp.byteLength < 6 || !face.upem || face.upem > 16384)
          throw new Error('Invalid font metrics: ' + name);
        const count = new DataView(maxp.buffer, maxp.byteOffset, maxp.byteLength).getUint16(4);
        if (!count) throw new Error('Font has no glyphs: ' + name);
        catalog.faces[name] = count;
        font.setScale(face.upem, face.upem);
        generator.loadFont(name, bytes);
        for (const range of ranges) {
          for (let start = 0; start < count; start += GLYPHS_PER_SHARD) {
            const glyphs = [],
              pixels = [];
            for (
              let id = Math.max(1, start);
              id < Math.min(start + GLYPHS_PER_SHARD, count);
              id++
            ) {
              const ext = font.glyphExtents(id);
              if (!ext?.width || !ext?.height) continue; // Spacing still comes from HarfBuzz.
              const path = font.glyphToPath(id);
              if (path.length > 65536) throw new Error(`Glyph outline too large: ${name} #${id}`);
              const g = generator.generate({ id, range, key: '' }, path, face.upem);
              glyphs.push({ id, width: g.width, height: g.height, plane: g.plane, path });
              pixels.push(encodeRGB(g));
            }
            if (!glyphs.length) continue;
            const header = Buffer.from(
              JSON.stringify({
                version: 2,
                assets,
                face: name,
                range,
                start,
                upem: face.upem,
                glyphs,
              }),
            );
            const size = Buffer.alloc(4);
            size.writeUInt32LE(header.length);
            const raw = Buffer.concat([size, header, ...pixels]);
            if (header.length > PACK_HEADER_LIMIT || raw.length > MAX_MSDF_BYTES)
              throw new Error('Shard exceeds budget.');
            const file = gzipSync(raw);
            await publish(join(dir, shardPath(assets, name, range, start)), file);
            bitmaps += glyphs.length;
            totalBytes += file.length;
            shards++;
          }
        }
      } finally {
        font.destroy();
        face.destroy();
        blob.destroy();
      }
    }
    for (const file of licenses)
      await publish(join(dir, file), await readFile(join(sdk, 'fonts', file)));
    await publish(join(dir, 'manifest.json'), JSON.stringify(catalog) + '\n');
    console.log(
      `${faces.size} font files, ${bitmaps} glyph bitmaps, ${shards} shards, ${totalBytes} bytes: ${dir}`,
    );
  } finally {
    generator.dispose();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
