import type { ArcCollection, StrokeStyle, PointStyle, VertexDotStyle } from '../types/mapshaper-types';

export interface Painter {
  prepare(extent: any): void;
  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void;
  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void;
  drawPoints(shapes: any[], style: PointStyle): void;
  drawVertexDots?(shapes: any[], arcs: ArcCollection, style: VertexDotStyle): void;
  clear(): void;
  resize(width: number, height: number): void;
  setTransform(transform: any): void;
  setPixelRatio(ratio: number): void;
  flush?(): void;
}

export interface RenderOptions {
  antialias?: boolean;
}
