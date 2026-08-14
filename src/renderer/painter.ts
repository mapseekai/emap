import type { MeasurementMode, MeasurementPoint } from '../geo/measurement';

import type { AffineTransform } from '../geo/transform';
import type {
  ArcCollection,
  PathShape,
  FeatureShape,
  StrokeStyle,
  PointStyle,
  VertexDotStyle,
} from '../types/mapshaper-types';

/** Geometry kind currently being authored by the draw overlay. */
export type DrawOverlayGeometryType = 'polygon' | 'polyline' | 'point';

/** Snap-target kind under the draw cursor. `null` when no target. */
export type DrawOverlaySnapKind = 'vertex' | 'edge' | null;

/**
 * Render-domain state for {@link Painter.drawDrawingOverlay}.
 * Owned by the renderer so painters do not back-reference `map/`.
 * The map module re-exports this as `EditDrawState` for back-compat.
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
  label: string | null;
  labelCoord: MeasurementPoint | null;
  completed: boolean;
  drawColor: string;
}

export interface PolygonFillOptions {
  /** Current viewport bbox in data coordinates, used to reject offscreen parts before path iteration. */
  viewBBox?: readonly [number, number, number, number] | number[] | null;
}

export interface ArrowDotPathOptions {
  shapes: readonly (PathShape | null | undefined)[];
  cacheKey: string;
  geometryRevision: number;
}

/**
 * Stateless drawing primitives: enough to render basemap topology, points,
 * polygons, and arc highlights. Anything that paints actual map content
 * should depend on `CorePainter`, not the broader `Painter`/`EditPainter`.
 */
export interface CorePainter {
  drawPaths(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: StrokeStyle,
    arcs: ArcCollection,
  ): void;
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (i: number) => boolean,
    arcIds?: Uint32Array,
    arrowDot?: ArrowDotPathOptions,
  ): void;
  drawPoints(shapes: readonly (FeatureShape | null | undefined)[], style: PointStyle): void;
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
  drawDrawingOverlay(state: DrawOverlayState): void;
  drawMeasurementOverlay(state: MeasurementOverlayState): void;
}

/**
 * Legacy alias preserved for callers that already import `Painter`.
 * The full painter interface is the edit-aware one because every
 * existing concrete painter (`CanvasPainter`) implements both halves.
 */
export type Painter = EditPainter;

export interface RenderOptions {
  antialias?: boolean;
}
