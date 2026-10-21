/** Render-only packed buffers; source datasets retain their original topology. */
export interface GeometryBuffer {
  kind: 'fill' | 'line' | 'point' | 'path';
  /** Valid-segment affine MSAA layout; not the raw shared-neighbor ABI. */
  compactStroke?: boolean;
  /** All endpoint low parts were exactly zero; no coordinate rounding occurred. */
  compactStrokeXY?: boolean;
  /** Number of original non-zero path segments, excluding padding instances. */
  segmentCount?: number;
  /** Conservative source-space bounds of immutable contiguous path instance ranges. */
  pathRanges?: PathRangeData;
  /** Local packet member, first instance and count; only Worker path meshes.
   * Keeps shared polygon boundaries independently selectable during cold frames. */
  memberRanges?: Uint32Array;
  /** Immutable source-space bounds of indexed triangle ranges. */
  fillRanges?: FillRangeData;
  vertices: Float32Array;
  indices?: Uint16Array | Uint32Array;
  count: number;
  /** Synchronous derived screen paths use the same source-anchored frame as Worker chunks. */
  screenView?: readonly [number, number, number, number];
}
export type Rgba = [number, number, number, number];
export type Rect = readonly [number, number, number, number];
export interface MeshPaint {
  /** Derived Canvas screen paths only; original/edit meshes remain in source coordinates. */
  screenSpace?: boolean;
  /** Original affine view for replaying derived screen paths at a new camera. */
  screenView?: readonly [number, number, number, number];
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
  /** Compact screen envelope range metadata; extreme joins remain unculled. */
  uncullable?: Uint8Array;
  envelopeHalfWidths?: number;
  blockSize: number;
  bounds: Float64Array;
  segments: Uint32Array;
}
export interface PathDrawRange {
  firstInstance: number;
  count: number;
}

export interface FillRangeData {
  blockSize: number;
  bounds: Float64Array;
}
export interface FillDrawRange {
  firstIndex: number;
  indexCount: number;
}
