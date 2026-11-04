import { createAbortScope } from '../../shared/abort-scope';
import { awaitWithSignal } from '../../shared/await-with-signal';
import { fetchBytes, fetchMsdfResource, MsdfHttpError, readMsdfBytes } from './resource';
import {
  GLYPHS_PER_SHARD,
  GLYPH_RANGES,
  MSDF_EM_PIXELS,
  PACK_HEADER_LIMIT,
  shardPath,
  type GeneratedGlyph,
  type GlyphCatalog,
  type GlyphRequest,
  type FontSelection,
} from './protocol';

export interface GlyphPackOptions {
  url: string | URL;
  report: (error: Error) => void;
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid MSDF font catalog or glyph shard.');
}
function checkRecord(value: unknown): asserts value is Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value));
}
function integer(v: unknown, low: number, high: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= low && v <= high;
}
function isPlane(value: unknown): value is GeneratedGlyph['plane'] {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite);
}
function validateCatalog(value: unknown, stamp: string): asserts value is GlyphCatalog {
  checkRecord(value);
  check(value.version === 2 && /^[a-f0-9]{64}$/.test(stamp) && value.assets === stamp);
  const ranges = value.ranges;
  check(
    Array.isArray(ranges) &&
      ranges.length > 0 &&
      ranges.length <= GLYPH_RANGES.length &&
      ranges.every((r: unknown) => GLYPH_RANGES.some((v) => r === v)),
  );
  checkRecord(value.faces);
  const faces = Object.entries(value.faces);
  check(faces.length > 0 && faces.length <= 4096);
  for (const [name, count] of faces) {
    check(
      (/^fonts\/[\w-]+\.woff$/.test(name) || /^font-[a-f0-9]{64}\.(woff|ttf|otf)$/.test(name)) &&
        integer(count, 1, 65535),
    );
  }
  const custom = value.defaultFont;
  if (custom !== undefined) {
    checkRecord(custom);
    check(
      typeof custom.face === 'string' &&
        !custom.face.startsWith('fonts/') &&
        Object.hasOwn(value.faces, custom.face),
    );
    check(
      typeof custom.family === 'string' &&
        ['sans-serif', 'serif', 'monospace'].includes(custom.family) &&
        (custom.weight === 400 || custom.weight === 700),
    );
  }
}
type Metrics = Pick<GeneratedGlyph, 'width' | 'height' | 'plane' | 'path'> & { id: number };
interface Shard {
  size: number;
  get(request: GlyphRequest): GeneratedGlyph;
}

function decodeShard(
  bytes: ArrayBuffer,
  assets: string,
  face: string,
  start: number,
  range: number,
  count: number,
): Shard {
  check(bytes.byteLength >= 4);
  const size = new DataView(bytes).getUint32(0, true);
  check(size > 0 && size <= PACK_HEADER_LIMIT && size <= bytes.byteLength - 4);
  const h: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, size)));
  checkRecord(h);
  const upem = h.upem;
  check(
    h.version === 2 &&
      h.assets === assets &&
      h.face === face &&
      h.range === range &&
      h.start === start,
  );
  check(integer(upem, 1, 16384) && Array.isArray(h.glyphs) && h.glyphs.length <= GLYPHS_PER_SHARD);
  let offset = 4 + size;
  const entries = new Map<number, { g: Metrics; rgb: Uint8Array }>();
  for (const g of h.glyphs as unknown[]) {
    checkRecord(g);
    check(
      integer(g.id, Math.max(1, start), Math.min(start + GLYPHS_PER_SHARD, count) - 1) &&
        !entries.has(g.id),
    );
    check(integer(g.width, 1, 512) && integer(g.height, 1, 512));
    check(isPlane(g.plane));
    check(typeof g.path === 'string' && g.path.length <= 65536);
    const length = g.width * g.height * 3;
    check(offset + length <= bytes.byteLength);
    const { id, width, height, plane: bounds, path } = g;
    entries.set(id, {
      g: { id, width, height, plane: bounds, path },
      rgb: new Uint8Array(bytes, offset, length),
    });
    offset += length;
  }
  check(offset === bytes.byteLength);
  return {
    size: bytes.byteLength,
    get(request) {
      const entry = entries.get(request.id);
      check(entry);
      const { g, rgb } = entry,
        area = g.width * g.height,
        data = new Uint8Array(area * 4);
      for (let i = 0; i < area; i++) {
        const rowStart = i % g.width === 0,
          at = i * 4;
        for (let channel = 0; channel < 3; channel++)
          data[at + channel] = rgb[channel * area + i] + (rowStart ? 0 : data[at - 4 + channel]);
        data[at + 3] = 255;
      }
      return { ...g, key: request.key, range, upem, emPixels: MSDF_EM_PIXELS, data };
    },
  };
}

const MAX_TRANSFERS = 6;
const LAYOUT_SHARD_WAIT_MS = 2000;
const RETRY_AFTER_MS = 30_000;

interface ShardRequest {
  path: string;
  face: string;
  start: number;
  range: number;
  glyphs: GlyphRequest[];
}
interface Transfer {
  controller: AbortController;
  promise: Promise<Shard | undefined>;
  waiters: number;
}

/** The atlas owns transfers. Layouts share active reads and release them when their last waiter leaves. */
export class ProjectGlyphPack {
  private url?: URL;
  private catalog?: GlyphCatalog;
  private loading?: Promise<void>;
  private retryAt = 0;
  private lastLayout?: AbortSignal;
  private defaultFont?: FontSelection;
  private faces = new Map<string, string>();
  private readonly controller = new AbortController();
  private readonly budgets = new WeakMap<
    AbortSignal,
    { remaining: number; deadline: number; waiters: number }
  >();
  private readonly pending = new Map<string, Transfer>();
  private readonly cache = new Map<string, Shard>();
  private readonly failures = new Map<string, number>();
  private bytes = 0;

  constructor(
    private readonly options: GlyphPackOptions,
    private readonly baseURI: string,
    private readonly workerUrl: URL,
  ) {}

  async ready(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.controller.signal.throwIfAborted();
    if (this.catalog) return;
    if (!this.loading && this.lastLayout !== signal && Date.now() >= this.retryAt) {
      this.loading = this.load()
        .catch((error: unknown) => {
          if (this.controller.signal.aborted) return;
          const transient =
            error instanceof TypeError ||
            (error instanceof DOMException && error.name === 'TimeoutError') ||
            (error instanceof MsdfHttpError &&
              (error.status >= 500 || error.status === 408 || error.status === 429));
          this.retryAt = transient ? Date.now() + RETRY_AFTER_MS : Infinity;
          this.report(error);
        })
        .finally(() => {
          this.loading = undefined;
        });
    }
    this.lastLayout = signal;
    if (this.loading) await awaitWithSignal(this.loading, signal);
    signal.throwIfAborted();
    this.controller.signal.throwIfAborted();
  }

  private async load(): Promise<void> {
    const requested = new URL(this.options.url, this.baseURI);
    check(['http:', 'https:'].includes(requested.protocol));
    const base = new URL('msdf/', this.workerUrl);
    const timeout = new AbortController();
    const scope = createAbortScope([this.controller.signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(new DOMException('MSDF font manifest timed out.', 'TimeoutError')),
      3000,
    );
    try {
      const [file, stamp] = await Promise.all([
        fetchMsdfResource(requested.href, scope.signal, PACK_HEADER_LIMIT),
        fetchBytes(new URL('assets.sha256', base).href, scope.signal, 128),
      ]);
      scope.signal.throwIfAborted();
      const url = new URL(file.url);
      check(['http:', 'https:'].includes(url.protocol));
      const h: unknown = JSON.parse(new TextDecoder().decode(file.bytes));
      validateCatalog(h, new TextDecoder().decode(stamp).trim());
      const resolved = new Map<string, string>();
      for (const face of Object.keys(h.faces))
        resolved.set(new URL(face, face.startsWith('fonts/') ? base : url).href, face);
      if (h.defaultFont) {
        const { family, weight, face } = h.defaultFont;
        this.defaultFont = { family, weight, url: new URL(face, url).href };
      }
      this.url = url;
      this.faces = resolved;
      this.catalog = h;
    } finally {
      clearTimeout(timer);
      timeout.abort();
      scope.dispose();
    }
  }

  selectFont(font: FontSelection): FontSelection {
    const custom = this.defaultFont;
    return !font.url &&
      custom &&
      font.family.toLowerCase() === custom.family &&
      (font.weight >= 600 ? 700 : 400) === custom.weight
      ? { ...font, url: custom.url }
      : font;
  }

  private report(cause: unknown) {
    if (!this.controller.signal.aborted)
      this.options.report(
        new Error('MSDF font resource unavailable; using the font worker.', { cause }),
      );
  }

  private cached(path: string): Shard | undefined {
    const hit = this.cache.get(path);
    if (hit) {
      this.cache.delete(path);
      this.cache.set(path, hit);
    }
    return hit;
  }

  private async readShard(
    h: GlyphCatalog,
    group: ShardRequest,
    signal: AbortSignal,
  ): Promise<Shard> {
    const { path, face, start, range } = group;
    const file = await fetchBytes(new URL(path, this.url).href, signal);
    const magic = new Uint8Array(file);
    const bytes =
      magic[0] === 31 && magic[1] === 139
        ? await readMsdfBytes(
            new Response(file).body!.pipeThrough(new DecompressionStream('gzip'), { signal }),
          )
        : file; // The server may already have applied Content-Encoding: gzip.
    signal.throwIfAborted();
    const shard = decodeShard(bytes, h.assets, face, start, range, h.faces[face]);
    this.cache.set(path, shard);
    this.bytes += shard.size;
    for (const [key, entry] of this.cache) {
      if (this.bytes <= 16 * 1024 ** 2) break;
      this.cache.delete(key);
      this.bytes -= entry.size;
    }
    this.failures.delete(path);
    return shard;
  }

  private start(h: GlyphCatalog, group: ShardRequest): Transfer {
    const { path } = group,
      controller = new AbortController();
    const promise = this.readShard(h, group, controller.signal)
      .catch((error) => {
        if (!controller.signal.aborted) {
          this.failures.set(path, Date.now() + RETRY_AFTER_MS);
          if (this.failures.size > 256) this.failures.delete(this.failures.keys().next().value!);
          this.report(error);
        }
        return undefined;
      })
      .finally(() => this.pending.delete(path));
    const flight = { controller, promise, waiters: 0 };
    this.pending.set(path, flight);
    return flight;
  }

  private async shard(
    h: GlyphCatalog,
    group: ShardRequest,
    signal: AbortSignal,
  ): Promise<Shard | undefined> {
    for (;;) {
      signal.throwIfAborted();
      const hit = this.cached(group.path);
      if (hit) return hit;
      if ((this.failures.get(group.path) ?? 0) > Date.now()) return undefined;
      let flight = this.pending.get(group.path);
      if (!flight && this.pending.size < MAX_TRANSFERS) flight = this.start(h, group);
      if (flight && !flight.controller.signal.aborted) {
        flight.waiters++;
        try {
          return await awaitWithSignal(flight.promise, signal);
        } finally {
          if (--flight.waiters === 0 && signal.aborted) flight.controller.abort();
        }
      }
      // Aborted transports still occupy a slot until their fetch actually settles.
      await awaitWithSignal(
        Promise.race(Array.from(this.pending.values(), (f) => f.promise)),
        signal,
      );
    }
  }

  async glyphs(
    requests: GlyphRequest[],
    signal: AbortSignal,
  ): Promise<Map<string, GeneratedGlyph>> {
    const result = new Map<string, GeneratedGlyph>();
    await this.ready(signal);
    signal.throwIfAborted();
    const h = this.catalog;
    if (!h) return result;
    const groups = new Map<string, ShardRequest>();
    for (const r of requests) {
      const face = this.faces.get(r.font);
      if (!face || !h.ranges.includes(r.range) || !integer(r.id, 1, h.faces[face] - 1)) continue;
      const start = Math.floor(r.id / GLYPHS_PER_SHARD) * GLYPHS_PER_SHARD;
      const path = shardPath(h.assets, face, r.range, start);
      let group = groups.get(path);
      if (!group) {
        group = { path, face, start, range: r.range, glyphs: [] };
        groups.set(path, group);
      }
      group.glyphs.push(r);
    }
    const collect = (group: ShardRequest, shard: Shard) => {
      for (const glyph of group.glyphs) {
        try {
          result.set(glyph.key, shard.get(glyph));
        } catch (error) {
          this.report(error);
        }
      }
    };
    for (const [path, group] of groups) {
      const hit = this.cached(path);
      if (hit) {
        collect(group, hit);
        groups.delete(path);
      }
    }
    if (!groups.size) return result;
    // Share the layout's network budget without charging CPU work between batches.
    let budget = this.budgets.get(signal);
    if (!budget) {
      budget = { remaining: LAYOUT_SHARD_WAIT_MS, deadline: 0, waiters: 0 };
      this.budgets.set(signal, budget);
    }
    const now = performance.now();
    if (budget.waiters === 0) budget.deadline = now + budget.remaining;
    const left = budget.deadline - now;
    if (left <= 0) return result;
    budget.waiters++;
    const timeout = new AbortController();
    const scope = createAbortScope([signal, this.controller.signal, timeout.signal]);
    const timer = setTimeout(
      () => timeout.abort(new Error('MSDF glyph shard wait budget expired.')),
      left,
    );
    const queue = groups.values();
    const consume = async () => {
      for (const group of queue) {
        const shard = await this.shard(h, group, scope.signal);
        scope.signal.throwIfAborted();
        if (shard) collect(group, shard);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(MAX_TRANSFERS, groups.size) }, consume));
    } catch (error) {
      signal.throwIfAborted();
      this.controller.signal.throwIfAborted();
      if (!timeout.signal.aborted) throw error;
      this.report(error);
    } finally {
      if (timeout.signal.aborted) budget.remaining = 0;
      if (--budget.waiters === 0)
        budget.remaining = Math.max(
          0,
          Math.min(budget.remaining, budget.deadline - performance.now()),
        );
      clearTimeout(timer);
      scope.dispose();
    }
    return result;
  }
  dispose(): void {
    this.controller.abort();
    for (const flight of this.pending.values()) flight.controller.abort();
    this.pending.clear();
    this.cache.clear();
    this.faces.clear();
    this.failures.clear();
    this.bytes = 0;
  }
}
