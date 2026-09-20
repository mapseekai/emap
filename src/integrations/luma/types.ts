/** Render-only packed buffers; source datasets retain their original topology. */
export interface GeometryBuffer {
  kind: 'fill' | 'line' | 'point' | 'path';
  /** Number of original non-zero path segments, excluding padding instances. */
  segmentCount?: number;
  vertices: Float32Array;
  indices?: Uint32Array;
  count: number;
}
export type Rgba = [number, number, number, number];
export type Rect = readonly [number, number, number, number];
export interface MeshPaint {
  color: Rgba;
  width?: number;
  radius?: number;
  filled?: boolean;
  marker?: readonly number[];
  dash?: readonly number[];
  arrow?: { spacing: number; size: number };
}
