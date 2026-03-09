/**
 * TypeScript interfaces for Mapshaper data structures.
 * These replace pervasive `any` usage across the codebase.
 */

// ---------------------------------------------------------------------------
// Arc iteration
// ---------------------------------------------------------------------------

/** Iterator returned by ArcCollection.getArcIter() */
export interface ArcIterator {
  x: number;
  y: number;
  hasNext(): boolean;
}

// ---------------------------------------------------------------------------
// Arc collection
// ---------------------------------------------------------------------------

/** Mapshaper's ArcCollection — manages all arcs in a dataset */
export interface ArcCollection {
  size(): number;
  getArcIter(arcId: number): ArcIterator;

  // Simplification
  setRetainedInterval?(interval: number): ArcCollection;
  getRetainedInterval?(): number;
  getThresholdByPct?(pct: number, nth?: number): number;
  isFlat?(): boolean;
  getFilteredCopy?(): ArcCollection;

  // Vertex access
  getPointCount?(): number;
  getVertexData?(): { xx: Float64Array; yy: Float64Array; zz?: Float64Array };
  getVertex2?(vertexId: number): [number, number] | null;
  transformPoints?(cb: (x: number, y: number) => void): void;

  // Spatial queries
  getSimpleShapeBbox?(shapeIds: number[], bbox: number[]): void;
  arcIsSmaller?(i: number, minLen: number): boolean;
  arcIntersectsBBox?(i: number, bbox: number[]): boolean;
}

// ---------------------------------------------------------------------------
// Layer & Dataset
// ---------------------------------------------------------------------------

export type GeometryType = 'point' | 'polyline' | 'polygon';

/** A single layer within a Mapshaper dataset */
export interface MapshaperLayer {
  name?: string;
  id?: string;
  geometry_type?: GeometryType;
  shapes: any[][] | null;
  data?: {
    getRecordAt?(id: number): Record<string, unknown>;
    getRecords?(): Record<string, unknown>[];
  };
}

/** A Mapshaper dataset containing layers and arcs */
export interface MapshaperDataset {
  layers: MapshaperLayer[];
  arcs?: ArcCollection;
  info?: {
    crs_string?: string;
    prj?: string;
    crs?: {
      is_latlong?: boolean;
      projName?: string;
      a?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Render styles
// ---------------------------------------------------------------------------

/** Style for stroke-based rendering (lines, polygon outlines) */
export interface StrokeStyle {
  color?: string;
  width?: number;
}

/** Style for point rendering */
export interface PointStyle {
  color?: string;
  radius?: number;
  fill?: boolean;
}

/** Style for vertex dot rendering in edit mode */
export interface VertexDotStyle {
  dotColor?: string;
  dotRadius?: number;
  hoverVertex?: [number, number] | null;
  hoverColor?: string;
  hoverRadius?: number;
  /** Fill color for polygon shapes in vertex edit mode */
  polygonFill?: string | null;
  geometryType?: string;
}
