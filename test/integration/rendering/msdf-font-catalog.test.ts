import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { MsdfFontEngine } from '../../../src/integrations/msdf/font-engine';
import { ProjectGlyphPack } from '../../../src/integrations/msdf/glyph-pack';
import type { ShapeRequest } from '../../../src/integrations/msdf/protocol';

it('builds a project font without labels, then serves a new ligature and both halo tiers through one URL', async () => {
  const out = await mkdtemp(join(tmpdir(), 'emap-project-font-'));
  const base = 'https://sdk.test/msdf/',
    root = 'https://fonts.test/site/';
  const reads: string[] = [];
  const read = async (url: string) => {
    reads.push(url);
    const loc = url.startsWith(base)
      ? join(resolve('dist/msdf'), url.slice(base.length))
      : join(out, url.slice(root.length));
    return new Uint8Array(await readFile(loc)).buffer;
  };
  const report = vi.fn();
  const pack = new ProjectGlyphPack(
    { url: root + 'manifest.json', report },
    root,
    new URL('../worker.js', base),
  );
  let engine: MsdfFontEngine | undefined;
  try {
    await promisify(execFile)(process.execPath, [
      'dist/emap-glyph-pack.cjs',
      out,
      '--font',
      'dist/msdf/fonts/noto-sans-sc-latin-400-normal.woff',
      '--range',
      '32',
      '--range',
      '64',
    ]);
    vi.stubGlobal('fetch', async (url: string) => new Response(await read(url)));
    engine = await MsdfFontEngine.create(base, read);
    const signal = new AbortController().signal;
    const requests: ShapeRequest[] = [
      { text: 'Office P3', key: 'k', font: { family: 'sans-serif', weight: 400 } },
    ];
    await pack.ready(signal);
    requests[0].font = pack.selectFont(requests[0].font);
    expect(requests[0].font.url).toMatch(/^https:\/\/fonts\.test\/site\/font-\w+\.woff$/);
    const shape = await engine.shape(requests[0], signal);
    expect(shape.missing).toBe(0);
    expect(shape.glyphs.length).toBeLessThan('OfficeP3'.length); // The font substitutes ffi.
    expect(shape.glyphs.every((g) => g.font === requests[0].font.url)).toBe(true);
    const glyphs = [32, 64].flatMap((range) =>
      shape.glyphs.map((g) => ({ ...g, range, key: JSON.stringify([g.font, g.id, range]) })),
    );
    const packed = await pack.glyphs(glyphs, signal);
    expect(new Set(packed.keys())).toEqual(new Set(glyphs.map((g) => g.key)));
    expect(report).not.toHaveBeenCalled();
    expect(reads.some((url) => url.endsWith('/msdfgen.wasm'))).toBe(false);
    expect(reads.filter((url) => url.endsWith('.msdf')).length).toBeLessThan(glyphs.length);
  } finally {
    pack.dispose();
    engine?.dispose();
    vi.unstubAllGlobals();
    await rm(out, { recursive: true, force: true });
  }
}, 45000);
