/** Render-only packed buffers; source datasets retain their original topology. */
export interface GeometryBuffer {
  kind: 'fill' | 'line' | 'point' | 'path';
  /** Number of original non-zero path segments, excluding padding instances. */
  segmentCount?: number;
  /** Conservative source-space bounds of immutable contiguous path instance ranges. */
  pathRanges?: PathRangeData;
  vertices: Float32Array;
  indices?: Uint32Array;
  count: number;
}
export type Rgba = [number, number, number, number];
export type Rect = readonly [number, number, number, number];
export interface MeshPaint {
  /** Derived Canvas screen paths only; original/edit meshes remain in source coordinates. */
  screenSpace?: boolean;
  /** Internal immutable sprite style; source point buffers remain unchanged. */
  icon?: {
    size: readonly [number, number];
    anchor: readonly [number, number];
    offset: readonly [number, number];
    angle: number;
    tint: boolean;
    textureSize: readonly [number, number];
  };
  color: Rgba;
  width?: number;
  radius?: number;
  filled?: boolean;
  marker?: readonly number[];
  dash?: readonly number[];
  arrow?: { spacing: number; size: number };
}

export interface PathRangeData {
  blockSize: number;
  bounds: Float64Array;
  segments: Uint32Array;
}
export interface PathDrawRange {
  firstInstance: number;
  count: number;
}
