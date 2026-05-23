import type { AffineTransform } from '../geo/transform';
import type {
  ArcCollection,
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
 * Stateless drawing primitives: enough to render basemap topology, points,
 * polygons, and arc highlights. Anything that paints actual map content
 * should depend on `CorePainter`, not the broader `Painter`/`EditPainter`.
 */
export interface CorePainter {
  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void;
  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void;
  drawPoints(shapes: any[], style: PointStyle): void;
  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
    fillRule?: 'nonzero' | 'evenodd',
    shapeIdxFilter?: ((sIdx: number) => boolean) | null,
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
  drawVertexDots(shapes: any[], arcs: ArcCollection, style: VertexDotStyle): void;
  drawDrawingOverlay(state: DrawOverlayState): void;
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
