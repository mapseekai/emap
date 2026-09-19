import { makeRasterWarp } from './warp';
import { resolveRasterRanges, stretchRasterValue } from '../../../domain/raster/statistics';
import { AffineTransform } from '../../../domain/geo/transform';
import { RasterError, validateRasterWindow } from '../../../domain/raster/policy';
import type {
  RasterLevel,
  RasterMetadata,
  RasterReadRequest,
  RasterReadResult,
  RasterStyle,
  RasterWindow,
  RasterWarpMesh,
} from '../../../domain/raster/types';
import type { RasterCoordinateTransform } from './projector';

export const RASTER_TILE_SIZE = 256;
// Near a pyramid boundary, decoding full-resolution tiled blocks can cost several times
// more I/O/CPU than using the next tiled overview. Bound that quality tradeoff: an
// overview pixel may cover at most 1.4 display pixels. Row-striped bases may also use a tiled overview.
const TILED_OVERVIEW_MAX_UPSAMPLING = 1.4;

function isSpatiallyTiled(level: RasterLevel): boolean {
  return level.tileWidth < level.width && level.tileHeight < level.height;
}
function isRowStriped(level: RasterLevel): boolean {
  return level.tileWidth >= level.width && level.tileHeight < level.height;
}
export interface RasterLevelSelection {
  readonly level: RasterLevel;
  /** Approximate base-source pixels represented by one display pixel at tile center. */
  readonly sourcePixelsPerDisplayPixel: number;
}
interface RasterLevelContext extends RasterLevelSelection {
  readonly base: RasterLevel;
  readonly locateBase: (x: number, y: number) => [number, number] | null;
}
function rasterLevelContext(
  metadata: RasterMetadata,
  bounds: RasterWindow,
  toSource: RasterCoordinateTransform,
  size: number,
): RasterLevelContext {
  const base = metadata.levels[0];
  const pixelTransform = new AffineTransform(
    metadata.resolution[0],
    metadata.resolution[1],
    metadata.origin[0],
    metadata.origin[1],
  );
  const screen = new AffineTransform(
    (bounds[2] - bounds[0]) / size,
    (bounds[1] - bounds[3]) / size,
    bounds[0],
    bounds[3],
  );
  const locateBase = (x: number, y: number): [number, number] | null => {
    const world = screen.project(x, y),
      source = toSource(world[0], world[1]);
    if (!source || !source.every(Number.isFinite)) return null;
    return pixelTransform.unproject(source[0], source[1]);
  };
  const center = locateBase(size / 2, size / 2),
    dx = locateBase(size / 2 + 1, size / 2),
    dy = locateBase(size / 2, size / 2 + 1);
  let sourcePixelsPerDisplayPixel = 1;
  if (center && dx && dy)
    sourcePixelsPerDisplayPixel = Math.min(
      Math.hypot(dx[0] - center[0], dx[1] - center[1]),
      Math.hypot(dy[0] - center[0], dy[1] - center[1]),
    );
  let level = base;
  for (const candidate of metadata.levels.slice(1)) {
    const reduction = Math.max(base.width / candidate.width, base.height / candidate.height);
    const oversampling =
      isSpatiallyTiled(candidate) && (isSpatiallyTiled(base) || isRowStriped(base))
        ? TILED_OVERVIEW_MAX_UPSAMPLING
        : 1;
    if (reduction <= sourcePixelsPerDisplayPixel * oversampling && candidate.width < level.width)
      level = candidate;
  }
  return { base, level, locateBase, sourcePixelsPerDisplayPixel };
}

/** Lightweight LOD selection used both by planning diagnostics and the actual tile plan. */
export function selectRasterLevel(
  metadata: RasterMetadata,
  bounds: RasterWindow,
  toSource: RasterCoordinateTransform,
  size = RASTER_TILE_SIZE,
): RasterLevelSelection {
  if (!Number.isInteger(size) || size < 1 || size > 1024)
    throw new RasterError('INVALID_RASTER_RENDER', 'Display tile edge must be 1–1024 pixels.');
  const { level, sourcePixelsPerDisplayPixel } = rasterLevelContext(
    metadata,
    bounds,
    toSource,
    size,
  );
  return { level, sourcePixelsPerDisplayPixel };
}
export interface RasterTilePlan {
  readonly request: RasterReadRequest;
  readonly warp: RasterWarpMesh;
  readonly level: RasterLevel;
  readonly width: number;
  readonly height: number;
  readonly locate: (x: number, y: number, output?: [number, number]) => [number, number] | null;
  readonly bands: readonly number[];
}
export function rasterBands(metadata: RasterMetadata, style: RasterStyle): readonly number[] {
  if (style.bands) return style.bands;
  if (metadata.palette) return [0];
  const available = Array.from({ length: metadata.levels[0].samples }, (_, i) => i).filter(
    (band) => band !== metadata.alphaBand,
  );
  return available.length >= 3 ? available.slice(0, 3) : available.slice(0, 1);
}
export function validateRasterStyle(metadata: RasterMetadata, style: RasterStyle): void {
  if (
    style.stretch !== undefined &&
    !['auto', 'minmax', 'percentile', 'none'].includes(style.stretch)
  )
    throw new RasterError('INVALID_RASTER_STYLE', 'Unknown stretch mode.');
  const bands = rasterBands(metadata, style);
  if (
    ![1, 3].includes(bands.length) ||
    bands.some((b) => !Number.isInteger(b) || b < 0 || b >= metadata.levels[0].samples)
  )
    throw new RasterError('INVALID_RASTER_STYLE', 'Select one grayscale band or three RGB bands.');
  if (
    style.opacity !== undefined &&
    (!Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1)
  )
    throw new RasterError('INVALID_RASTER_STYLE', 'Opacity must be between 0 and 1.');
  if (style.resampling !== undefined && !['nearest', 'bilinear'].includes(style.resampling))
    throw new RasterError('INVALID_RASTER_STYLE', 'Unknown resampling method.');
  if (
    style.ranges &&
    (style.ranges.length !== bands.length ||
      style.ranges.some((r) => r.length !== 2 || !r.every(Number.isFinite) || r[1] <= r[0]))
  )
    throw new RasterError(
      'INVALID_RASTER_STYLE',
      'Provide one finite increasing display range per selected band.',
    );
}

/** Build a bounded inverse-warp mesh. Sample checks refine cells down to one display pixel. */
export function planRasterTile(
  metadata: RasterMetadata,
  bounds: RasterWindow,
  toSource: RasterCoordinateTransform,
  style: RasterStyle = {},
  size = RASTER_TILE_SIZE,
): RasterTilePlan | null {
  if (!Number.isInteger(size) || size < 1 || size > 1024)
    throw new RasterError('INVALID_RASTER_RENDER', 'Display tile edge must be 1–1024 pixels.');
  validateRasterStyle(metadata, style);
  const { base, level, locateBase } = rasterLevelContext(metadata, bounds, toSource, size);
  const rx = level.width / base.width,
    ry = level.height / base.height;
  const exact = (x: number, y: number): [number, number] | null => {
    const p = locateBase(x, y);
    return p ? [p[0] * rx, p[1] * ry] : null;
  };
  let step = 16,
    grid: Array<[number, number] | null> = [],
    columns = 0;
  while (true) {
    columns = Math.ceil(size / step) + 1;
    grid = [];
    for (let row = 0; row < columns; row++)
      for (let col = 0; col < columns; col++) grid.push(exact(col * step, row * step));
    if (step === 1) break;
    let refine = false;
    for (let row = 0; row < columns - 1 && !refine; row++)
      for (let col = 0; col < columns - 1; col++) {
        const corners = [
          grid[row * columns + col],
          grid[row * columns + col + 1],
          grid[(row + 1) * columns + col],
          grid[(row + 1) * columns + col + 1],
        ];
        const middle = exact((col + 0.5) * step, (row + 0.5) * step);
        if (!middle || corners.some((p) => !p)) {
          if (middle || corners.some((p) => p)) refine = true;
          continue;
        }
        const x = corners.reduce((sum, p) => sum + p![0], 0) / 4,
          y = corners.reduce((sum, p) => sum + p![1], 0) / 4;
        if (Math.hypot(x - middle[0], y - middle[1]) > 0.2) {
          refine = true;
          break;
        }
      }
    if (!refine) break;
    step /= 2;
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of grid)
    if (p) {
      minX = Math.min(minX, p[0]);
      minY = Math.min(minY, p[1]);
      maxX = Math.max(maxX, p[0]);
      maxY = Math.max(maxY, p[1]);
    }
  if (
    maxX <= 0 ||
    maxY <= 0 ||
    minX >= level.width ||
    minY >= level.height ||
    !Number.isFinite(minX)
  )
    return null;
  const window: RasterWindow = [
    Math.max(0, Math.floor(minX) - 1),
    Math.max(0, Math.floor(minY) - 1),
    Math.min(level.width, Math.ceil(maxX) + 1),
    Math.min(level.height, Math.ceil(maxY) + 1),
  ];
  const bands = rasterBands(metadata, style);
  const samples = [
    ...new Set([...bands, ...(metadata.alphaBand === null ? [] : [metadata.alphaBand])]),
  ];
  validateRasterWindow(level, window, samples);
  const locate = (x: number, y: number, output?: [number, number]): [number, number] | null => {
    const col = Math.min(columns - 2, Math.floor(x / step)),
      row = Math.min(columns - 2, Math.floor(y / step));
    const u = x / step - col,
      v = y / step - row;
    const a = grid[row * columns + col],
      b = grid[row * columns + col + 1],
      c = grid[(row + 1) * columns + col],
      d = grid[(row + 1) * columns + col + 1];
    if (!a || !b || !c || !d) return exact(x, y);
    const result = output ?? [0, 0];
    result[0] = (a[0] * (1 - u) + b[0] * u) * (1 - v) + (c[0] * (1 - u) + d[0] * u) * v;
    result[1] = (a[1] * (1 - u) + b[1] * u) * (1 - v) + (c[1] * (1 - u) + d[1] * u) * v;
    return result;
  };
  return {
    request: { level: level.id, window, samples },
    warp: makeRasterWarp(grid, columns, step, size, locate),
    level,
    width: size,
    height: size,
    locate,
    bands,
  };
}

/** Numerical data stays untouched; RGBA is a disposable display derivation.
 * With a caller-owned target, only nontransparent pixels are written, preserving
 * previous row chunks exactly as an opaque-pixel merge would (not alpha blending).
 */
export function colorizeRasterTile(
  metadata: RasterMetadata,
  plan: RasterTilePlan,
  result: RasterReadResult,
  style: RasterStyle = {},
  target?: Uint8ClampedArray<ArrayBuffer>,
): Uint8ClampedArray<ArrayBuffer> {
  const length = plan.width * plan.height * 4;
  if (target && target.length !== length)
    throw new RasterError('INVALID_RASTER_RENDER', 'RGBA target size does not match the tile.');
  const out = target ?? new Uint8ClampedArray(length);
  const window = plan.request.window,
    sourceIndices = plan.bands.map((band) => plan.request.samples.indexOf(band));
  const alphaIndex =
    metadata.alphaBand === null ? -1 : plan.request.samples.indexOf(metadata.alphaBand);
  const ranges = resolveRasterRanges(metadata, style, plan.bands);
  // Explicit bands display numerical samples; omitted bands preserve indexed colors.
  const palette = style.bands === undefined ? metadata.palette : undefined;
  const valid = (value: number) =>
    Number.isFinite(value) && (metadata.noData === null || value !== metadata.noData);
  const alphaBand = metadata.alphaBand;
  const alphaMax =
    alphaBand === null || plan.level.formats[alphaBand] === 3
      ? 1
      : 2 ** (plan.level.bits[alphaBand] - (plan.level.formats[alphaBand] === 2 ? 1 : 0)) - 1;
  const position: [number, number] = [0, 0];
  const gray = sourceIndices.length === 1;
  const red = result.data[sourceIndices[0]],
    green = result.data[sourceIndices[gray ? 0 : 1]],
    blue = result.data[sourceIndices[gray ? 0 : 2]];
  const alpha = alphaIndex < 0 ? undefined : result.data[alphaIndex];
  const rRange = ranges[0],
    gRange = ranges[gray ? 0 : 1],
    bRange = ranges[gray ? 0 : 2];
  if (style.resampling !== 'bilinear' || palette) {
    // Fast numeric nearest-neighbor path: no per-pixel map/every/temporary arrays.
    // Inverse warping still uses the same checked mesh and NoData/alpha rules.
    for (let y = 0; y < plan.height; y++)
      for (let x = 0; x < plan.width; x++) {
        const p = plan.locate(x + 0.5, y + 0.5, position);
        if (!p || p[0] < 0 || p[1] < 0 || p[0] >= plan.level.width || p[1] >= plan.level.height)
          continue;
        const sx = Math.floor(p[0]),
          sy = Math.floor(p[1]);
        if (sx < window[0] || sy < window[1] || sx >= window[2] || sy >= window[3]) continue;
        const index = (sy - window[1]) * result.width + sx - window[0];
        const rv = red[index],
          gv = green[index],
          bv = blue[index];
        if (!valid(rv) || (!gray && (!valid(gv) || !valid(bv)))) continue;
        const opacity = alpha ? (alpha[index] / alphaMax) * 255 : 255;
        // Uint8ClampedArray rounds 0.5 to zero. Do not overwrite RGB either
        // when this chunk would have produced a transparent partial pixel.
        if (target && (!Number.isFinite(opacity) || opacity <= 0.5)) continue;
        const offset = (y * plan.width + x) * 4;
        if (palette) {
          const entry = Math.floor(rv),
            count = palette.length / 3;
          out[offset] = palette[entry] / 257;
          out[offset + 1] = palette[count + entry] / 257;
          out[offset + 2] = palette[count * 2 + entry] / 257;
        } else {
          let r = stretchRasterValue(rv, rRange),
            g = gray ? r : stretchRasterValue(gv, gRange),
            b = gray ? r : stretchRasterValue(bv, bRange);
          if (plan.level.photometric === 0) {
            r = 255 - r;
            g = 255 - g;
            b = 255 - b;
          }
          out[offset] = r;
          out[offset + 1] = g;
          out[offset + 2] = b;
        }
        out[offset + 3] = Number.isFinite(opacity) ? opacity : 0;
      }
    return out;
  }

  // Reuse scalar channel state for all four taps. Avoid per-pixel arrays,
  // callbacks and destructuring in the high-resolution bilinear path.
  for (let y = 0; y < plan.height; y++)
    for (let x = 0; x < plan.width; x++) {
      const p = plan.locate(x + 0.5, y + 0.5, position);
      if (!p || p[0] < 0 || p[1] < 0 || p[0] >= plan.level.width || p[1] >= plan.level.height)
        continue;
      const fx = p[0] - 0.5,
        fy = p[1] - 0.5;
      const left = Math.floor(fx),
        top = Math.floor(fy),
        u = fx - left,
        v = fy - top;
      let rSum = 0,
        gSum = 0,
        bSum = 0,
        weight = 0;
      for (let tap = 0; tap < 4; tap++) {
        const dx = tap & 1,
          dy = tap >> 1;
        const sx = Math.max(0, Math.min(plan.level.width - 1, left + dx));
        const sy = Math.max(0, Math.min(plan.level.height - 1, top + dy));
        if (sx < window[0] || sy < window[1] || sx >= window[2] || sy >= window[3]) continue;
        const index = (sy - window[1]) * result.width + sx - window[0];
        const rv = red[index],
          gv = green[index],
          bv = blue[index];
        if (!valid(rv) || (!gray && (!valid(gv) || !valid(bv)))) continue;
        const w = (dx ? u : 1 - u) * (dy ? v : 1 - v);
        rSum += rv * w;
        if (!gray) {
          gSum += gv * w;
          bSum += bv * w;
        }
        weight += w;
      }
      if (!weight) continue;
      const rv = rSum / weight,
        gv = gray ? rv : gSum / weight,
        bv = gray ? rv : bSum / weight;
      // Only source samples are tested against NoData; interpolation can validly
      // produce the sentinel value from otherwise valid neighbors.
      if (!Number.isFinite(rv) || !Number.isFinite(gv) || !Number.isFinite(bv)) continue;
      let r = stretchRasterValue(rv, rRange),
        g = gray ? r : stretchRasterValue(gv, gRange),
        b = gray ? r : stretchRasterValue(bv, bRange);
      if (plan.level.photometric === 0) {
        r = 255 - r;
        g = 255 - g;
        b = 255 - b;
      }
      const nx = Math.floor(p[0]),
        ny = Math.floor(p[1]);
      const opacity = alpha
        ? nx < window[0] || ny < window[1] || nx >= window[2] || ny >= window[3]
          ? NaN
          : (alpha[(ny - window[1]) * result.width + nx - window[0]] / alphaMax) * 255
        : 255;
      if (target && (!Number.isFinite(opacity) || opacity <= 0.5)) continue;
      const offset = (y * plan.width + x) * 4;
      out[offset] = r;
      out[offset + 1] = g;
      out[offset + 2] = b;
      out[offset + 3] = Number.isFinite(opacity) ? opacity : 0;
    }
  return out;
}
