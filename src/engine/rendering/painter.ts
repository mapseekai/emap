import type { PointIcon } from './icons/images';
import type { LabelFrame } from './labels/manager';
import type { MeasurementMode, MeasurementPoint } from '../../domain/geo/measurement';

import type { AffineTransform } from '../../domain/geo/transform';
import type {
  ArcCollection,
  PathShape,
  FeatureShape,
  StrokeStyle,
  PointStyle,
  VertexDotStyle,
} from '../../shared/types/mapshaper-types';

/** Geometry kind currently being authored by the draw overlay. */
export type DrawOverlayGeometryType = 'polygon' | 'polyline' | 'point';

/** Snap-target kind under the draw cursor. `null` when no target. */
export type DrawOverlaySnapKind = 'vertex' | 'edge' | null;

/**
 * Render-domain state for {@link EditPainter.drawDrawingOverlay}.
 * Owned by the renderer so painters do not back-reference `map/`.
 * Input to {@link EditPainter.drawDrawingOverlay}.
 */
export interface DrawOverlayState {
  vertices: [number, number][];
  cursorCoord: [number, number] | null;
  snapCoord: [number, number] | null;
  snapKind: DrawOverlaySnapKind;
  geometryType: DrawOverlayGeometryType;
  drawColor: string;
}

/**
 * Render-domain state for a temporary length or area measurement.
 * The coordinates are map coordinates; paths may contain extra sampled
 * geodesic points while `vertices` contains only user-confirmed points.
 */
export interface MeasurementOverlayState {
  mode: MeasurementMode;
  vertices: readonly MeasurementPoint[];
  committedPath: readonly MeasurementPoint[];
  previewPath: readonly MeasurementPoint[] | null;
  fillPath: readonly MeasurementPoint[] | null;
  /** Per-segment length labels, each anchored at its segment's geodesic midpoint. */
  segmentLabels: readonly MeasurementSegmentLabel[];
  /** Total length at the cursor/final vertex, or total area at the polygon center. */
  label: string | null;
  labelCoord: MeasurementPoint | null;
  completed: boolean;
  drawColor: string;
}

/** A formatted measurement value anchored at a map coordinate. */
export interface MeasurementSegmentLabel {
  label: string;
  coord: MeasurementPoint;
}

export interface FillStyleBuckets {
  /** styleId → 该桶的 shape 索引（升序、去重）。 */
  buckets: readonly Uint32Array[];
  /** styleId → 颜色，与 buckets 等长。 */
  colors: readonly string[];
}

export interface PolygonFillOptions {
  /** Ordered spatial candidates for a single-color fill. */
  shapeIndices?: Uint32Array;
  /** Current viewport bbox in data coordinates, used to reject offscreen parts before path iteration. */
  viewBBox?: readonly [number, number, number, number] | number[] | null;
  /** 存在时逐桶填充（每桶一次样式切换）；缺省走原单样式路径。 */
  styleBuckets?: FillStyleBuckets;
}

export interface ArrowDotPathOptions {
  shapes: readonly (PathShape | null | undefined)[];
  /** Optional feature indices to render without materializing sparse shape arrays. */
  shapeIndices?: Uint32Array;
  cacheKey: string;
  geometryRevision: number;
}

/**
 * Stateless drawing primitives: enough to render basemap topology, points,
 * polygons, and arc highlights. Anything that paints actual map content
 * should depend on `CorePainter`, not the broader `Painter`/`EditPainter`.
 */
export interface CorePainter {
  /** @internal Optional image symbols, consuming the same original/LOD point selection. */
  drawPointIcons?(
    shapes: readonly (FeatureShape | null | undefined)[],
    icon: PointIcon,
    shapeIndices?: Uint32Array,
    componentIndices?: Uint32Array,
  ): void;
  /** @internal Release derived Canvas icon images on source replacement/disposal. */
  clearIcons?(): void;
  /** @internal Optional owner-bound text pass; geometry-only painters remain compatible. */
  drawLabels?(frame: LabelFrame): void;
  /** Draw a north-up image in map coordinates without exposing the native canvas. */
  drawRasterImage(
    image: CanvasImageSource,
    bounds: readonly [number, number, number, number],
    opacity?: number,
    smoothing?: boolean,
    /** Map-coordinate subregion; shared boundaries are snapped to device pixels. */
    clipBounds?: readonly [number, number, number, number],
  ): void;
  drawPaths(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: StrokeStyle,
    arcs: ArcCollection,
    arcFilter?: (i: number) => boolean,
    shapeIndices?: Uint32Array,
    /** Bump when shapes or bucket membership mutate; enables ordered arc-list caching. */
    geometryRevision?: number,
  ): void;
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (i: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrowDot?: ArrowDotPathOptions,
  ): void;
  drawPoints(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: PointStyle,
    shapeIndices?: Uint32Array,
    /** One original component per shapeIndices entry (MultiPoint LOD). */
    componentIndices?: Uint32Array,
  ): void;
  drawPolygonFill(
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
    options?: PolygonFillOptions,
  ): void;
  clear(): void;
  resize(width: number, height: number): void;
  setTransform(transform: AffineTransform): void;
  setPixelRatio(ratio: number): void;
}

/**
 * Adds the edit-mode-only overlay primitives — vertex dots and the
 * draw-overlay state machine — on top of `CorePainter`. Code that does
 * not paint editing affordances should not depend on this interface.
 */
export interface EditPainter extends CorePainter {
  drawVertexDots(
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    style: VertexDotStyle,
  ): void;
  drawVertexBand(band: { x0: number; y0: number; x1: number; y1: number }): void;
  drawDrawingOverlay(state: DrawOverlayState): void;
  drawMeasurementOverlay(state: MeasurementOverlayState): void;
}
