export interface Painter {
  prepare(extent: any): void;
  drawPaths(shapes: any[], style: any, arcs: any): void;
  drawArcs(arcs: any, style: any, filter?: (i: number) => boolean): void;
  drawPoints(shapes: any[], style: any): void;
  clear(): void;
  resize(width: number, height: number): void;
  setTransform(transform: any): void;
  setPixelRatio(ratio: number): void;
  flush?(): void; // Optional: used by CanvasKit to flush GPU commands
}

export interface RenderOptions {
  antialias?: boolean;
}
