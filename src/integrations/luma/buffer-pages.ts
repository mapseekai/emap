import { Buffer, type Device } from '@luma.gl/core';
import type { GeometryBuffer } from './types';

export const PAGE_SLACK_RESERVE = 16 * 1024 ** 2;
interface PageSlot {
  vertexStart: number;
  indexStart: number;
  vertexCapacity: number;
  indexCapacity: number;
}
export interface GeometryPage {
  free: PageSlot[];
  key: string;
  buffer: Buffer;
  indices?: Buffer;
  vertexCapacity: number;
  indexCapacity: number;
  vertexEnd: number;
  indexEnd: number;
  bytes: number;
  liveBytes: number;
  refs: number;
}
export interface GeometrySlice {
  page: GeometryPage;
  slot: PageSlot;
  firstInstance: number;
  firstIndex: number;
  storageCount: number;
  bytes: number;
  released: boolean;
}
export function pageEligible(g: GeometryBuffer): boolean {
  return (
    (g.kind === 'path' && !!g.compactStroke) ||
    (g.kind === 'fill' && g.indices instanceof Uint16Array && g.vertices.length <= 65535 * 4)
  );
}
export function pagePayloadBytes(g: GeometryBuffer): number {
  return (
    g.vertices.byteLength +
    (g.kind === 'fill' ? Math.ceil((g.indices?.byteLength ?? 0) / 12) * 12 : 0)
  );
}
/** Direct first-upload pages, never a second copy of already resident geometry.
 * Slices preserve draw order and retired slots are reused; empty pages are destroyed immediately.
 * Fragmented slack is accounted separately, not hidden as live source geometry. */
export class GeometryBufferPages {
  private open = new Map<string, GeometryPage>();
  private pages = new Set<GeometryPage>();
  private groups = new Map<string, Set<GeometryPage>>();
  allocatedBytes = 0;
  liveBytes = 0;
  get slackBytes(): number {
    return this.allocatedBytes - this.liveBytes;
  }
  get size(): number {
    return this.pages.size;
  }
  constructor(private readonly device: Device) {}
  allocate(g: GeometryBuffer, group: string): GeometrySlice {
    if (!pageEligible(g) || !g.count) throw new Error('Unsupported pooled geometry format');
    const stride = g.compactStroke ? (g.compactStrokeXY ? 48 : 64) : 16;
    const vertexBytes = g.vertices.byteLength;
    const indexBytes = g.indices ? Math.ceil(g.indices.byteLength / 12) * 12 : 0;
    const bytes = vertexBytes + indexBytes;
    const key = group + ':' + g.kind + ':' + !!g.compactStroke + ':' + !!g.compactStrokeXY;
    let page = this.open.get(key),
      slot: PageSlot | undefined;
    // Reuse retired storage without copying any still-resident slice.
    for (const candidate of this.groups.get(key) ?? []) {
      const at = candidate.free.findIndex(
        (s) => s.vertexCapacity >= vertexBytes && s.indexCapacity >= indexBytes,
      );
      if (at >= 0) {
        page = candidate;
        slot = candidate.free.splice(at, 1)[0];
        break;
      }
    }
    if (
      !slot &&
      (!page ||
        page.vertexEnd + vertexBytes > page.vertexCapacity ||
        page.indexEnd + indexBytes > page.indexCapacity)
    ) {
      for (const candidate of this.groups.get(key) ?? []) {
        if (
          candidate.vertexEnd + vertexBytes <= candidate.vertexCapacity &&
          candidate.indexEnd + indexBytes <= candidate.indexCapacity
        ) {
          page = candidate;
          break;
        }
      }
    }
    if (
      !slot &&
      (!page ||
        page.vertexEnd + vertexBytes > page.vertexCapacity ||
        page.indexEnd + indexBytes > page.indexCapacity)
    ) {
      // Scale the two capacities together: a fixed 2:1 vertex/index ratio leaves
      // permanently stranded index tails for simple buildings and defeats pooling.
      const available = bytes + Math.max(0, PAGE_SLACK_RESERVE - this.slackBytes);
      let copies = Math.max(1, Math.floor(Math.min(512 * 1024, available) / bytes));
      if (g.indices) copies = Math.max(1, Math.min(copies, Math.floor((65535 * 16) / vertexBytes)));
      const vertexCapacity = vertexBytes * copies,
        indexCapacity = indexBytes * copies;
      const buffer = this.device.createBuffer({
        byteLength: vertexCapacity,
        usage: Buffer.VERTEX | Buffer.COPY_DST,
      });
      let indices: Buffer | undefined;
      try {
        if (indexCapacity)
          indices = this.device.createBuffer({
            byteLength: indexCapacity,
            usage: Buffer.INDEX | Buffer.COPY_DST,
            indexType: 'uint16',
          });
      } catch (error) {
        buffer.destroy();
        throw error;
      }
      page = {
        free: [],
        key,
        buffer,
        indices,
        vertexCapacity,
        indexCapacity,
        vertexEnd: 0,
        indexEnd: 0,
        bytes: vertexCapacity + indexCapacity,
        liveBytes: 0,
        refs: 0,
      };
      this.pages.add(page);
      let groupPages = this.groups.get(key);
      if (!groupPages) this.groups.set(key, (groupPages = new Set()));
      groupPages.add(page);
      this.open.set(key, page);
      this.allocatedBytes += page.bytes;
    }
    if (!page) throw new Error('Missing geometry page');
    const recycled = !!slot;
    slot ??= {
      vertexStart: page.vertexEnd,
      indexStart: page.indexEnd,
      vertexCapacity: vertexBytes,
      indexCapacity: indexBytes,
    };
    const firstInstance = slot.vertexStart / stride,
      firstIndex = slot.indexStart / 2;
    try {
      page.buffer.write(g.vertices, slot.vertexStart);
      if (g.indices) {
        const indices = new Uint16Array(indexBytes / 2),
          base = slot.vertexStart / 16;
        for (let i = 0; i < g.indices.length; i++) {
          const id = g.indices[i] + base;
          if (id >= 65535) throw new RangeError('Pooled uint16 vertex index overflow');
          indices[i] = id;
        }
        // Complete zero-area triangles pad to 4-byte writes and keep merged runs triangle aligned.
        page.indices!.write(indices, slot.indexStart);
      }
    } catch (error) {
      if (!page.refs) this.destroyPage(page);
      else if (recycled) this.returnSlot(page, slot);
      throw error;
    }
    // Commit a split only after both writes succeed. A failed upload restores
    // the entire free interval, never an overlapping partial tail.
    if (recycled && (slot.vertexCapacity > vertexBytes || slot.indexCapacity > indexBytes)) {
      this.returnSlot(page, {
        vertexStart: slot.vertexStart + vertexBytes,
        indexStart: slot.indexStart + indexBytes,
        vertexCapacity: slot.vertexCapacity - vertexBytes,
        indexCapacity: slot.indexCapacity - indexBytes,
      });
      slot = { ...slot, vertexCapacity: vertexBytes, indexCapacity: indexBytes };
    }
    page.vertexEnd = Math.max(page.vertexEnd, slot.vertexStart + slot.vertexCapacity);
    page.indexEnd = Math.max(page.indexEnd, slot.indexStart + slot.indexCapacity);
    page.refs++;
    page.liveBytes += bytes;
    this.liveBytes += bytes;
    return {
      page,
      slot,
      firstInstance: g.compactStroke ? firstInstance : 0,
      firstIndex,
      storageCount: g.indices ? indexBytes / 2 : g.count,
      bytes,
      released: false,
    };
  }
  release(slice: GeometrySlice): void {
    if (slice.released) return;
    slice.released = true;
    const page = slice.page;
    if (!this.pages.has(page)) return;
    this.returnSlot(page, slice.slot);
    page.refs--;
    page.liveBytes -= slice.bytes;
    this.liveBytes -= slice.bytes;
    if (!page.refs) this.destroyPage(page);
  }
  private returnSlot(page: GeometryPage, slot: PageSlot): void {
    // Both streams must be adjacent: a live vertex/index interval must never
    // be crossed when independently sized fill slices share a page.
    const free = page.free;
    let low = 0,
      high = free.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (free[mid].vertexStart < slot.vertexStart) low = mid + 1;
      else high = mid;
    }
    let at = low;
    free.splice(at, 0, { ...slot });
    const adjacent = (a: PageSlot, b: PageSlot) =>
      a.vertexStart + a.vertexCapacity === b.vertexStart &&
      a.indexStart + a.indexCapacity === b.indexStart;
    const merge = (i: number) => {
      free[i].vertexCapacity += free[i + 1].vertexCapacity;
      free[i].indexCapacity += free[i + 1].indexCapacity;
      free.splice(i + 1, 1);
    };
    if (at > 0 && adjacent(free[at - 1], free[at])) {
      merge(at - 1);
      at--;
    }
    if (at + 1 < free.length && adjacent(free[at], free[at + 1])) merge(at);
  }
  private destroyPage(page: GeometryPage): void {
    if (!this.pages.delete(page)) return;
    if (this.open.get(page.key) === page) this.open.delete(page.key);
    const group = this.groups.get(page.key);
    group?.delete(page);
    if (!group?.size) this.groups.delete(page.key);
    page.buffer.destroy();
    page.indices?.destroy();
    this.allocatedBytes -= page.bytes;
  }
  dispose(): void {
    for (const page of this.pages) this.destroyPage(page);
    this.open.clear();
    this.groups.clear();
    this.liveBytes = 0;
  }
}
