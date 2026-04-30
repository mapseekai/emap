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

export interface Painter {
  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void;
  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void;
  drawPoints(shapes: any[], style: PointStyle): void;
  drawVertexDots(shapes: any[], arcs: ArcCollection, style: VertexDotStyle): void;
  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
  ): void;
  drawDrawingOverlay(state: DrawOverlayState): void;
  clear(): void;
  resize(width: number, height: number): void;
  setTransform(transform: AffineTransform): void;
  setPixelRatio(ratio: number): void;
}

export interface RenderOptions {
  antialias?: boolean;
}
