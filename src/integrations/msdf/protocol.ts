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
export const PACK_HEADER_LIMIT = 2 * 1024 ** 2;
// Partition physical glyph IDs, including unencoded HarfBuzz substitutions.
export const GLYPHS_PER_SHARD = 16;
export const GLYPH_RANGES = [32, 64, 128, 256] as const;
export interface GlyphCatalog {
  version: 2;
  assets: string;
  ranges: number[];
  defaultFont?: { face: string; family: string; weight: number };
  /** SDK faces are relative to msdf/; a project font is relative to this catalog. */
  faces: Record<string, number>;
}
export function shardPath(assets: string, face: string, range: number, start: number): string {
  return `v2/${assets}/${face}/${range}/${start}-${start + GLYPHS_PER_SHARD - 1}.msdf`;
}
