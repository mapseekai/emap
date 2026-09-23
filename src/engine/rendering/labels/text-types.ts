import type { LabelOptions } from '../../map/label';
import type { LabelRaster } from './atlas';

export interface MsdfAtlasPage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  version: number;
}
export interface MsdfGlyphQuad {
  page: MsdfAtlasPage;
  rect: readonly [number, number, number, number];
  /** Glyph plane in label-local CSS pixels: center x/y, width/height. */
  plane: readonly [number, number, number, number];
  rangeCss: number;
  path: string;
  pathScale: number;
  origin: readonly [number, number];
}
export interface MsdfTextRaster {
  mode: 'msdf';
  width: number;
  height: number;
  glyphs: readonly MsdfGlyphQuad[];
  color: readonly [number, number, number, number];
  haloColor: readonly [number, number, number, number];
  haloWidth: number;
  shear: number;
}
export type TextRaster = LabelRaster | MsdfTextRaster;
export interface LabelTextRequest {
  text: string;
  options: LabelOptions;
}
export interface LabelAtlasProvider {
  readonly mode?: 'msdf';
  readonly bytes: number;
  readonly pageCount: number;
  readonly diagnostics?: Readonly<Record<string, number | string>>;
  begin(): void;
  /** Shape candidates in bounded batches, then rasterize accepted glyphs only. */
  prepare?(requests: readonly LabelTextRequest[], signal: AbortSignal): Promise<void>;
  reserve?(text: string, options: LabelOptions): boolean | void;
  prepareGlyphs?(requests: readonly LabelTextRequest[], signal: AbortSignal): Promise<void>;
  measure(
    text: string,
    options: LabelOptions,
    dpr: number,
  ): { width: number; height: number } | null;
  get(text: string, options: LabelOptions, dpr: number): TextRaster | null;
  clear(): void;
  dispose(): void;
}
