import { normalizePointShape } from '../../../domain/source/layer-utils';
import type { AffineTransform } from '../../../domain/geo/transform';
import type { FeatureShape } from '../../../shared/types/mapshaper-types';
import type { PointIcon } from './images';
/** Canvas compatibility uses the same decoded images and source/LOD selection as GPU. */
export class CanvasPointIcons {
  private variants = new Map<
    PointIcon,
    { image: HTMLCanvasElement; ratio: number; bytes: number }
  >();
  private bytes = 0;
  private image(icon: PointIcon, ratio: number): CanvasImageSource {
    if (!icon.tint) return icon.asset.image;
    const old = this.variants.get(icon);
    if (old?.ratio === ratio) {
      this.variants.delete(icon);
      this.variants.set(icon, old);
      return old.image;
    }
    if (old) {
      this.bytes -= old.bytes;
      old.image.width = old.image.height = 0;
      this.variants.delete(icon);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(icon.size[0] * ratio));
    canvas.height = Math.max(1, Math.ceil(icon.size[1] * ratio));
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(icon.asset.image, ...icon.rect, 0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = `rgb(${icon.color
      .slice(0, 3)
      .map((c) => Math.round(c * 255))
      .join(',')})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const bytes = canvas.width * canvas.height * 4;
    for (const [key, value] of this.variants) {
      if (this.bytes + bytes <= 8 * 1024 ** 2) break;
      value.image.width = value.image.height = 0;
      this.variants.delete(key);
      this.bytes -= value.bytes;
    }
    this.variants.set(icon, { image: canvas, ratio, bytes });
    this.bytes += bytes;
    return canvas;
  }
  draw(
    ctx: CanvasRenderingContext2D,
    view: AffineTransform,
    ratio: number,
    shapes: readonly (FeatureShape | null | undefined)[],
    icon: PointIcon,
    ids?: Uint32Array,
    components?: Uint32Array,
  ): void {
    if (icon.color[3] <= 0) return;
    const image = this.image(icon, Math.min(3, Math.max(1, ratio))),
      [w, h] = icon.size;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.globalAlpha = icon.color[3];
    ctx.imageSmoothingEnabled = true;
    for (let k = 0; k < (ids?.length ?? shapes.length); k++) {
      const points = normalizePointShape(shapes[ids?.[k] ?? k]),
        start = components?.[k] ?? 0,
        end = components ? start + 1 : points.length;
      for (let n = start; n < end; n++) {
        const p = points[n];
        if (!p) continue;
        const [x, y] = view.project(p[0], p[1]);
        if (
          !Number.isFinite(x + y) ||
          x + icon.bounds[2] < 0 ||
          y + icon.bounds[3] < 0 ||
          x + icon.bounds[0] > ctx.canvas.width / ratio ||
          y + icon.bounds[1] > ctx.canvas.height / ratio
        )
          continue;
        ctx.save();
        ctx.translate(x + icon.offset[0], y + icon.offset[1]);
        ctx.rotate(icon.angle);
        if (icon.tint) ctx.drawImage(image, -icon.anchor[0] * w, -icon.anchor[1] * h, w, h);
        else ctx.drawImage(image, ...icon.rect, -icon.anchor[0] * w, -icon.anchor[1] * h, w, h);
        ctx.restore();
      }
    }
    ctx.restore();
  }
  clear(): void {
    for (const v of this.variants.values()) v.image.width = v.image.height = 0;
    this.variants.clear();
    this.bytes = 0;
  }
}
