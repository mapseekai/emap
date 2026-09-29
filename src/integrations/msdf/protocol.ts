/** Serializable worker contracts. Font outlines and rasterization never run in the render loop. */
export interface FontSelection {
  family: string;
  weight: number;
  url?: string;
}
export interface ShapeRequest {
  key: string;
  text: string;
  font: FontSelection;
}
export interface ShapedGlyph {
  font: string;
  id: number;
  x: number;
  y: number;
}
export interface ShapedText {
  key: string;
  glyphs: ShapedGlyph[];
  /** Ink/advance bounds in em units, y down. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  missing: number;
}
export interface GlyphRequest {
  key: string;
  font: string;
  id: number;
  range: number;
}
export interface GeneratedGlyph {
  key: string;
  width: number;
  height: number;
  data: Uint8Array;
  /** Quad bounds relative to the glyph origin, em units, y down. */
  plane: [number, number, number, number];
  range: number;
  emPixels: number;
  /** Shaped outline for the Canvas reference path, not for GPU texture generation. */
  path: string;
  upem: number;
}
export interface FontAsset {
  url: string;
  ranges: [number, number][];
}
export type FontManifest = Record<string, FontAsset[]>;
export interface WorkerStats {
  fontBytes: number;
  fonts: number;
  glyphsGenerated: number;
  shapedRuns: number;
  heapBytes: number;
}
export const MSDF_EM_PIXELS = 48;
