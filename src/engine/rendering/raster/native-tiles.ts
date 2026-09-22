import { groundBounds, perspectiveActive } from '../../../domain/geo/perspective-transform';
import { AffineTransform } from '../../../domain/geo/transform';
import type { RasterMetadata, RasterLevel, RasterWindow } from '../../../domain/raster/types';
import { selectRasterLevel } from './tile';

export interface NativeRasterTile {
  readonly key: string;
  readonly level: RasterLevel;
  /** Nonoverlapping pixel-corner extent; texture reads include an additional halo. */
  readonly core: RasterWindow;
  readonly window: RasterWindow;
  readonly bounds: RasterWindow;
}
/** Same source CRS only. Uses the formal Canvas overview policy, not a different
 * resolution target. The source tile identity is independent of view and style. */
export function planNativeRasterTiles(
  metadata: RasterMetadata,
  view: AffineTransform,
  width: number,
  height: number,
  dpr: number,
): { tiles: NativeRasterTile[]; level: number; pixelSize: number } {
  if (
    ![width, height, dpr].every((n) => Number.isFinite(n) && n > 0) ||
    ![view.mx, view.my, view.bx, view.by].every(Number.isFinite) ||
    view.mx <= 0 ||
    view.my >= 0
  )
    throw new Error('Native raster requires a finite north-up source-CRS view.');
  const footprint = groundBounds(view, width, height),
    extent = metadata.bounds;
  const box: RasterWindow = [
    Math.max(footprint[0], extent[0]),
    Math.max(footprint[1], extent[1]),
    Math.min(footprint[2], extent[2]),
    Math.min(footprint[3], extent[3]),
  ];
  // Preserve the original 2D policy; perspective additionally resolves the near
  // side of the ground plane before applying the existing bounded tile budget.
  const resolution = perspectiveActive(view) ? view.groundResolution() : 1 / view.mx;
  let pixelSize = 2 ** (Math.floor(Math.log2(resolution / Math.min(2, dpr)) * 2) / 2);
  if (box[0] >= box[2] || box[1] >= box[3]) return { tiles: [], level: -1, pixelSize };
  // Match the single-source, 32 MiB formal Canvas display-tile planning budget.
  const count = () => {
    const span = pixelSize * 256;
    return (
      (Math.ceil((box[2] - extent[0]) / span) - Math.floor((box[0] - extent[0]) / span)) *
      (Math.ceil((box[3] - extent[1]) / span) - Math.floor((box[1] - extent[1]) / span))
    );
  };
  for (let n = 0; count() > 64 && n < 64; n++) pixelSize *= 2;
  const span = pixelSize * 256,
    cx = (box[0] + box[2]) / 2,
    cy = (box[1] + box[3]) / 2;
  const { level } = selectRasterLevel(
    metadata,
    [cx - span / 2, cy - span / 2, cx + span / 2, cy + span / 2],
    (x, y) => [x, y],
  );
  const base = metadata.levels[0];
  const transform = new AffineTransform(
    (metadata.resolution[0] * base.width) / level.width,
    (metadata.resolution[1] * base.height) / level.height,
    ...metadata.origin,
  );
  const p = transform.unproject(box[0], box[3]),
    q = transform.unproject(box[2], box[1]);
  // Group small native blocks into 512-pixel windows to amortize halo reads; wide strips use 256-pixel windows.
  const tiled = level.tileWidth < level.width;
  const tw = tiled ? Math.max(512, Math.min(1024, level.tileWidth)) : 256;
  const th = tiled ? Math.max(512, Math.min(1024, level.tileHeight)) : 256;
  const x0 = Math.max(0, Math.floor(p[0] / tw)),
    y0 = Math.max(0, Math.floor(p[1] / th));
  const x1 = Math.min(Math.ceil(level.width / tw), Math.ceil(q[0] / tw)),
    y1 = Math.min(Math.ceil(level.height / th), Math.ceil(q[1] / th));
  if ((x1 - x0) * (y1 - y0) > 4096)
    throw new Error('Visible native raster tile count exceeds the bounded working set.');
  const tiles: NativeRasterTile[] = [];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const core: RasterWindow = [
        x * tw,
        y * th,
        Math.min((x + 1) * tw, level.width),
        Math.min((y + 1) * th, level.height),
      ];
      const low = transform.project(core[0], core[3]),
        high = transform.project(core[2], core[1]);
      tiles.push({
        key: `${level.id}:${x}:${y}`,
        level,
        core,
        window: [
          Math.max(0, core[0] - 1),
          Math.max(0, core[1] - 1),
          Math.min(level.width, core[2] + 1),
          Math.min(level.height, core[3] + 1),
        ],
        bounds: [low[0], low[1], high[0], high[1]],
      });
    }
  tiles.sort(
    (a, b) =>
      Math.hypot((a.bounds[0] + a.bounds[2]) / 2 - cx, (a.bounds[1] + a.bounds[3]) / 2 - cy) -
      Math.hypot((b.bounds[0] + b.bounds[2]) / 2 - cx, (b.bounds[1] + b.bounds[3]) / 2 - cy),
  );
  return { tiles, level: level.id, pixelSize };
}
