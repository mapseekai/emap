import Flatbush from 'flatbush';
import { normalizePointShape } from '../../../domain/source/layer-utils';
import { cameraUniforms, groundBounds } from '../../../domain/geo/perspective-transform';
import type { AffineTransform } from '../../../domain/geo/transform';
import type { MapshaperDataset, MapshaperLayer } from '../../../shared/types/mapshaper-types';
import { compileStyleExpression } from '../../map/style-expression';
import { labelText, type LabelOptions } from '../../map/label';
import { LabelAtlas } from './atlas';
import type { LabelAtlasProvider, TextRaster } from './text-types';
import {
  featureBounds,
  featurePaths,
  polygonAnchor,
  linePose,
  LabelCollisionGrid,
  poseBounds,
  type LabelPose,
  type Box,
  type XY,
} from './geometry';

export interface LabelBinding {
  id: string;
  dataset: MapshaperDataset;
  layer: MapshaperLayer;
  options: LabelOptions;
  mask?: Uint8Array | null;
  pointRadius?: number;
}
export interface PlacedLabel extends LabelPose {
  ownerId: string;
  featureId: number;
  text: string;
  raster: TextRaster;
  bounds: Box;
  /** Ground anchor + CSS offset allow camera replay without scaling glyphs. */
  anchor?: XY;
  screenOffset?: XY;
  priority?: number;
  allowOverlap?: boolean;
  padding?: number;
}
export interface LabelFrame {
  key: string;
  labels: readonly PlacedLabel[];
}
interface IndexedLayer {
  dataset: MapshaperDataset;
  layer: MapshaperLayer;
  shapes: MapshaperLayer['shapes'];
  arcs: MapshaperDataset['arcs'];
  revision: number;
  tree: InstanceType<typeof Flatbush> | null;
  anchors: Map<number, XY | null>;
}
const MAX_CANDIDATES = 20000,
  MAX_LABELS = 2000;
const EMPTY: LabelFrame = { key: '', labels: [] };

/** Optional, asynchronous placement pass. Disabled maps pay no index/font/texture cost.
 * The original layer/feature remains the owner. Picking/editing use original geometries. */
export class BoundLabelManager {
  private atlas: LabelAtlasProvider;
  private indices = new Map<MapshaperLayer, IndexedLayer>();
  private ids = new WeakMap<object, number>();
  private serial = 0;
  private requested = '';
  private frame: LabelFrame = EMPTY;
  private frameView: AffineTransform | null = null;
  private requestedContent = '';
  private frameContent = '';
  private controller: AbortController | null = null;
  private task: Promise<void> = Promise.resolve();
  private disposed = false;
  private paused = false;
  private fontEpoch = 0;
  private fonts = new Set<string>();
  readonly stats = {
    pending: false,
    candidates: 0,
    placed: 0,
    collisionSkipped: 0,
    capacitySkipped: 0,
    layouts: 0,
    layoutMs: 0,
    atlasBytes: 0,
    atlasPages: 0,
  };
  constructor(
    private readonly invalidate: () => void,
    private readonly report: (error: Error) => void,
    private readonly document: Document = globalThis.document,
    atlas?: LabelAtlasProvider,
  ) {
    this.atlas = atlas ?? new LabelAtlas(document);
    if (!atlas?.mode) document.fonts?.addEventListener('loadingdone', this.fontChanged);
  }
  private fontChanged = (): void => {
    if (this.disposed) return;
    this.fontEpoch++;
    this.clear();
    this.fonts.clear();
    this.invalidate();
  };
  private identity(value: object | null | undefined): number {
    if (!value) return 0;
    let id = this.ids.get(value);
    if (!id) {
      id = ++this.serial;
      this.ids.set(value, id);
    }
    return id;
  }
  pause(value: boolean): void {
    if (this.paused === value) return;
    this.paused = value;
    if (value) {
      this.controller?.abort();
      this.requested = '';
      this.stats.pending = false;
    }
  }
  request(
    bindings: readonly LabelBinding[],
    view: AffineTransform,
    width: number,
    height: number,
    dpr: number,
    navigating = false,
  ): LabelFrame {
    if (this.disposed) return EMPTY;
    const active = bindings.filter(
      (b) =>
        b.options.enabled !== false &&
        Math.abs(view.mx) >= (b.options.minScale ?? 0) &&
        Math.abs(view.mx) <= (b.options.maxScale ?? Infinity),
    );
    if (!active.length) {
      if (this.requested || this.indices.size) this.clear();
      return EMPTY;
    }
    const content = JSON.stringify([
      dpr,
      this.fontEpoch,
      active.map((b) => [
        b.id,
        b.options,
        this.identity(b.dataset),
        this.identity(b.layer),
        this.identity(b.layer.shapes),
        this.identity(b.dataset.arcs),
        b.dataset.editVersion ?? 0,
        b.dataset.attributeVersion ?? 0,
        this.identity(b.mask),
        b.pointRadius,
      ]),
    ]);
    const key = JSON.stringify([
      view.mx,
      view.my,
      view.bx,
      view.by,
      cameraUniforms(view),
      width,
      height,
      content,
    ]);
    // Do not starve a long initial index/layout by cancelling it on every pointer
    // event. Only content changes supersede an in-flight navigation layout.
    if (navigating && this.stats.pending && this.requestedContent === content)
      return this.frameContent === content ? this.preview(view, width, height) : EMPTY;
    if (!this.paused && key !== this.requested) {
      this.controller?.abort();
      const controller = (this.controller = new AbortController());
      this.requested = key;
      this.requestedContent = content;
      this.stats.pending = true;
      const camera = view.clone();
      // Serial ownership of atlas pages; a cancelled job must settle before the next one writes.
      this.task = this.task
        .catch(() => {})
        .then(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          controller.signal.throwIfAborted();
          await this.layout(active, camera, width, height, dpr, key, controller.signal, content);
        })
        .catch((error) => {
          if (!controller.signal.aborted && !this.disposed) {
            this.stats.pending = false;
            this.report(error instanceof Error ? error : new Error(String(error)));
          }
        });
    }
    return this.frame.key === key
      ? this.frame
      : navigating && this.frameContent === content
        ? this.preview(view, width, height)
        : EMPTY;
  }
  /** Cheap camera-only text refresh between full layouts. Positions/collision
   * bounds change, but glyph scale, halo and point-label offsets remain CSS-sized.
   * New candidates are discovered by the asynchronous throttled request() path. */
  preview(view: AffineTransform, width: number, height: number): LabelFrame {
    if (!this.frameView || this.frameContent !== this.requestedContent || this.disposed)
      return EMPTY;
    const previous = this.frameView;
    if (
      view.mx === previous.mx &&
      view.my === previous.my &&
      view.bx === previous.bx &&
      view.by === previous.by
    )
      return this.frame;
    const grid = new LabelCollisionGrid(),
      accepted = new Map<PlacedLabel, PlacedLabel>();
    const ordered = [...this.frame.labels].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const label of ordered) {
      const ground = label.anchor ?? previous.unproject(label.x, label.y);
      const [x, y] = view.project(...ground),
        offset = label.screenOffset ?? [0, 0];
      if (!Number.isFinite(x + y)) continue;
      const angle = Math.atan2(
        (Math.sin(label.angle) * view.my) / previous.my,
        (Math.cos(label.angle) * view.mx) / previous.mx,
      );
      const pose = { x: x + offset[0], y: y + offset[1], angle };
      const bounds = poseBounds(pose, label.raster.width, label.raster.height, label.padding ?? 2);
      if (bounds[0] < 0 || bounds[1] < 0 || bounds[2] > width || bounds[3] > height) continue;
      if (!label.allowOverlap && grid.collides(bounds)) continue;
      grid.insert(bounds);
      accepted.set(label, { ...label, ...pose, bounds });
    }
    return {
      key: this.frame.key + ':nav:' + [view.mx, view.my, view.bx, view.by, width, height].join(':'),
      labels: this.frame.labels.flatMap((label) => {
        const next = accepted.get(label);
        return next ? [next] : [];
      }),
    };
  }
  get placements() {
    return this.frame.labels.map((l) => ({
      ownerId: l.ownerId,
      featureId: l.featureId,
      text: l.text,
      x: l.x,
      y: l.y,
      angle: l.angle,
      bounds: [...l.bounds],
    }));
  }
  async settled(): Promise<void> {
    await this.task;
  }
  private async index(binding: LabelBinding, signal: AbortSignal): Promise<IndexedLayer> {
    const { dataset, layer } = binding,
      revision = dataset.editVersion ?? 0;
    const cached = this.indices.get(layer);
    if (
      cached &&
      cached.dataset === dataset &&
      cached.shapes === layer.shapes &&
      cached.arcs === dataset.arcs &&
      cached.revision === revision
    )
      return cached;
    const count = layer.shapes?.length ?? 0;
    const tree = count ? new Flatbush(count) : null;
    let slice = performance.now();
    for (let id = 0; id < count; id++) {
      const b = featureBounds(dataset, layer, id);
      tree!.add(...(b.every(Number.isFinite) ? b : ([0, 0, 0, 0] as Box)));
      if (id % 256 === 0 && performance.now() - slice > 4) {
        await new Promise<void>((r) => setTimeout(r, 0));
        signal.throwIfAborted();
        slice = performance.now();
      }
    }
    signal.throwIfAborted();
    tree?.finish();
    const result = {
      dataset,
      layer,
      shapes: layer.shapes,
      arcs: dataset.arcs,
      revision,
      tree,
      anchors: new Map<number, XY | null>(),
    };
    this.indices.set(layer, result);
    return result;
  }
  private async layout(
    bindings: readonly LabelBinding[],
    view: AffineTransform,
    width: number,
    height: number,
    dpr: number,
    key: string,
    signal: AbortSignal,
    content: string,
  ): Promise<void> {
    const start = performance.now(),
      alive = new Set(bindings.map((b) => b.layer));
    for (const layer of this.indices.keys()) if (!alive.has(layer)) this.indices.delete(layer);
    const footprint = groundBounds(view, width, height, 32);
    const candidates: {
      binding: LabelBinding;
      id: number;
      text: string;
      priority: number;
      order: number;
    }[] = [];
    for (let order = bindings.length - 1; order >= 0; order--) {
      signal.throwIfAborted();
      const binding = bindings[order],
        { layer, options } = binding;
      const font = `${options.fontWeight ?? 'normal'} ${options.fontSize ?? 14}px ${options.fontFamily ?? 'sans-serif'}`;
      if (!this.atlas.mode && !this.fonts.has(font)) {
        this.fonts.add(font);
        void this.document.fonts?.load(font).catch(() => {});
      }
      const index = await this.index(binding, signal);
      const ids: number[] = index.tree?.search(...footprint) ?? [];
      if (ids.length > MAX_CANDIDATES) ids.length = MAX_CANDIDATES;
      ids.sort((a, b) => a - b);
      const text =
        options.field !== undefined
          ? (record: Record<string, unknown> | null | undefined) =>
              record && Object.hasOwn(record, options.field!) ? record[options.field!] : null
          : compileStyleExpression(options.text ?? '');
      const priority = compileStyleExpression(options.priority ?? 0);
      const records = layer.data?.getRecords?.();
      let slice = performance.now();
      for (let i = 0; i < ids.length && candidates.length < MAX_CANDIDATES; i++) {
        const id = ids[i];
        if (binding.mask && binding.mask[id] !== 1) continue;
        const record = layer.data?.getRecordAt?.(id) ?? records?.[id];
        const value = labelText(text(record));
        if (!value) continue;
        const p = priority(record);
        candidates.push({
          binding,
          id,
          text: value,
          priority: typeof p === 'number' && Number.isFinite(p) ? p : 0,
          order,
        });
        if (i % 256 === 0 && performance.now() - slice > 4) {
          await new Promise<void>((r) => setTimeout(r, 0));
          signal.throwIfAborted();
          slice = performance.now();
        }
      }
    }
    candidates.sort((a, b) => b.priority - a.priority || b.order - a.order || a.id - b.id);
    signal.throwIfAborted();
    this.atlas.begin();
    const grid = new LabelCollisionGrid(),
      accepted: (Omit<PlacedLabel, 'raster'> & { order: number; options: LabelOptions })[] = [];
    const counts = new Map<string, number>();
    let collisionSkipped = 0,
      capacitySkipped = 0,
      slice = performance.now();
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      const candidate = candidates[candidateIndex];
      if (candidateIndex % 128 === 0 && accepted.length < MAX_LABELS)
        await this.atlas.prepare?.(
          candidates
            .slice(candidateIndex, candidateIndex + 128)
            .map((c) => ({ text: c.text, options: c.binding.options })),
          signal,
        );
      signal.throwIfAborted();
      const { binding, id, text, order } = candidate,
        { dataset, layer, options } = binding;
      if (
        accepted.length >= MAX_LABELS ||
        (counts.get(binding.id) ?? 0) >= (options.maxLabels ?? 1000)
      ) {
        capacitySkipped++;
        continue;
      }
      const measured = this.atlas.measure(text, options, dpr);
      if (!measured) {
        capacitySkipped++;
        continue;
      }
      const poses: (LabelPose & { anchor?: XY })[] = [];
      if (layer.geometry_type === 'point') {
        for (const p of normalizePointShape(layer.shapes?.[id])) {
          const [x, y] = view.project(p[0], p[1]);
          if (!Number.isFinite(x + y)) continue;
          const gap = (binding.pointRadius ?? 4) + 3;
          for (const [dx, dy] of [
            [1, -1],
            [1, 0],
            [1, 1],
            [0, -1],
            [0, 1],
            [-1, -1],
            [-1, 0],
            [-1, 1],
          ])
            poses.push({
              x: x + dx * (measured.width / 2 + gap),
              y: y + dy * (measured.height / 2 + gap),
              angle: 0,
              anchor: [p[0], p[1]],
            });
          if (poses.length >= 64) break;
        }
      } else {
        if (layer.geometry_type === 'polygon') {
          const anchors = this.indices.get(layer)!.anchors;
          if (!anchors.has(id)) anchors.set(id, polygonAnchor(featurePaths(dataset, layer, id)));
          const anchor = anchors.get(id);
          if (anchor) {
            const [x, y] = view.project(...anchor);
            if (Number.isFinite(x + y)) poses.push({ x, y, angle: 0, anchor });
          }
        } else if (layer.geometry_type === 'polyline') {
          const pose = linePose(
            featurePaths(dataset, layer, id),
            view,
            width,
            height,
            measured.width,
            options.placement !== 'horizontal',
          );
          if (pose) poses.push({ ...pose, anchor: view.unproject(pose.x, pose.y) });
        }
      }
      let placed = false;
      for (const p of poses) {
        const pose = {
          ...p,
          x: p.x + (options.offset?.[0] ?? 0),
          y: p.y + (options.offset?.[1] ?? 0),
        };
        const box = poseBounds(pose, measured.width, measured.height, options.padding ?? 2);
        if (box[0] < 0 || box[1] < 0 || box[2] > width || box[3] > height) continue;
        if (!options.allowOverlap && grid.collides(box)) continue;
        if (this.atlas.reserve?.(text, options) === false) {
          capacitySkipped++;
          break;
        }
        grid.insert(box);
        const anchor = p.anchor ?? view.unproject(p.x, p.y),
          at = view.project(...anchor);
        accepted.push({
          ...pose,
          anchor,
          screenOffset: [pose.x - at[0], pose.y - at[1]],
          priority: candidate.priority,
          allowOverlap: options.allowOverlap,
          padding: options.padding,
          ownerId: binding.id,
          featureId: id,
          text,
          options,
          bounds: box,
          order,
        });
        counts.set(binding.id, (counts.get(binding.id) ?? 0) + 1);
        placed = true;
        break;
      }
      if (!placed) collisionSkipped++;
      if (performance.now() - slice > 4) {
        await new Promise<void>((r) => setTimeout(r, 0));
        signal.throwIfAborted();
        slice = performance.now();
      }
    }
    signal.throwIfAborted();
    await this.atlas.prepareGlyphs?.(accepted, signal);
    signal.throwIfAborted();
    const labels: (PlacedLabel & { order: number })[] = [];
    for (const item of accepted) {
      const raster = this.atlas.get(item.text, item.options, dpr);
      if (raster) labels.push({ ...item, raster });
      else capacitySkipped++;
    }
    labels.sort((a, b) => a.order - b.order || a.featureId - b.featureId);
    this.frame = { key, labels };
    this.frameView = view.clone();
    this.frameContent = content;
    Object.assign(this.stats, {
      pending: false,
      candidates: candidates.length,
      placed: labels.length,
      collisionSkipped,
      capacitySkipped,
      layouts: this.stats.layouts + 1,
      layoutMs: performance.now() - start,
      atlasBytes: this.atlas.bytes,
      atlasPages: this.atlas.pageCount,
      ...this.atlas.diagnostics,
    });
    this.invalidate();
  }
  /** Invalidate placements, but keep source indexes/interior anchors and font atlas reusable. */
  invalidateLayout(): void {
    this.controller?.abort();
    this.requested = '';
    this.frame = EMPTY;
    this.frameView = null;
    this.frameContent = this.requestedContent = '';
    this.stats.pending = false;
  }
  clear(): void {
    this.controller?.abort();
    this.requested = '';
    this.frame = EMPTY;
    this.frameView = null;
    this.frameContent = this.requestedContent = '';
    this.indices.clear();
    this.atlas.clear();
    Object.assign(this.stats, {
      pending: false,
      placed: 0,
      candidates: 0,
      atlasBytes: 0,
      atlasPages: 0,
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.atlas.dispose();
    this.document.fonts?.removeEventListener('loadingdone', this.fontChanged);
  }
}

export function drawCanvasLabels(
  ctx: CanvasRenderingContext2D,
  frame: LabelFrame,
  pixelRatio: number,
): void {
  ctx.save();
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const label of frame.labels) {
    const { raster } = label;
    ctx.save();
    ctx.translate(label.x, label.y);
    ctx.rotate(label.angle);
    if ('mode' in raster) {
      const rgba = (c: readonly number[]) =>
        `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${c[3]})`;
      ctx.fillStyle = rgba(raster.color);
      ctx.strokeStyle = rgba(raster.haloColor);
      ctx.lineJoin = 'round';
      // Reference renderer uses the same shaped outlines, not the RGB distance image.
      for (const halo of [true, false])
        for (const glyph of raster.glyphs) {
          if (halo && !raster.haloWidth) continue;
          ctx.save();
          ctx.translate(...glyph.origin);
          ctx.transform(glyph.pathScale, 0, raster.shear * glyph.pathScale, -glyph.pathScale, 0, 0);
          const path = new Path2D(glyph.path);
          if (halo) {
            ctx.lineWidth = (raster.haloWidth * 2) / glyph.pathScale;
            ctx.stroke(path);
          } else ctx.fill(path);
          ctx.restore();
        }
    } else
      ctx.drawImage(
        raster.page.canvas,
        ...raster.rect,
        -raster.width / 2,
        -raster.height / 2,
        raster.width,
        raster.height,
      );
    ctx.restore();
  }
  ctx.restore();
}
