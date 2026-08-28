declare module 'mapshaper' {
  import type { ArcCollection, MapshaperLayer, MapshaperDataset } from './mapshaper-types';

  /** Parsed mapshaper command (output of parseCommands) */
  interface MapshaperCommand {
    name: string;
    options: Record<string, any>;
  }

  /** A mapshaper Job — holds the catalog of datasets a command sequence operates on */
  interface MapshaperJob {
    catalog: {
      addDataset(dataset: MapshaperDataset | undefined): void;
      getDefaultTargets(): Array<{ dataset: MapshaperDataset; layers: MapshaperLayer[] }>;
    };
  }

  interface MapshaperJobConstructor {
    new (): MapshaperJob;
  }

  /** Bounds object returned by mapshaper geometry functions */
  interface MapshaperBounds {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
  }

  /**
   * Subset of mapshaper.internal that emap consumes.
   *
   * IMPORTANT: These are mapshaper's INTERNAL APIs (not stable across versions).
   * Pinned to mapshaper 0.6.x; verify on every dependency upgrade.
   */
  interface MapshaperInternal {
    // Command pipeline
    parseCommands(cmd: string): MapshaperCommand[];
    runParsedCommands(
      commands: MapshaperCommand[],
      job: MapshaperJob,
      callback: (err: any, job: MapshaperJob) => void,
    ): void;
    Job: MapshaperJobConstructor;

    // Layer / dataset metadata
    getDatasetBounds(dataset: MapshaperDataset): MapshaperBounds;
    layerHasGeometry(layer: MapshaperLayer): boolean;
    getLayerBounds(layer: MapshaperLayer, arcs: ArcCollection | undefined): MapshaperBounds | null;
    /**
     * Deep-copy a dataset (clones layers and arcs). Used to capture an
     * undoable snapshot before running a dataset-mutating command like
     * `-clip` / `-erase` / `-dissolve`.
     */
    copyDataset(dataset: MapshaperDataset): MapshaperDataset;

    /**
     * Detect line intersections, insert vertex cuts at every crossing, and
     * re-run `buildTopology` if anything changed. Mutates the dataset in
     * place and returns the resulting node collection. Used as a pre-pass
     * by every overlay command (`-clip` / `-erase` / `-dissolve` / etc.).
     */
    addIntersectionCuts(
      dataset: MapshaperDataset,
      opts?: {
        snap_interval?: number;
        no_snap?: boolean;
        rebuild_topology?: boolean;
        [k: string]: unknown;
      },
    ): unknown;

    /**
     * Read-only segment-intersection scan over an ArcCollection. Each
     * returned object carries `.x` / `.y` coordinates of an intersection
     * point (additional fields exist but aren't part of our public surface).
     */
    findSegmentIntersections(
      arcs: ArcCollection,
      opts?: { tolerance?: number; stripes?: number; [k: string]: unknown },
    ): Array<{ x: number; y: number; [k: string]: unknown }>;

    /**
     * Build a single multi-point feature whose `shapes[0]` is the array
     * of intersection point coords, filtered to intersections whose
     * arcs are referenced by the supplied layer's shapes. Used to
     * materialize `findSegmentIntersections` output as a real point layer.
     */
    getIntersectionLayer(
      intersections: ReadonlyArray<{ x: number; y: number; [k: string]: unknown }>,
      lyr: MapshaperLayer,
      arcs: ArcCollection,
    ): { geometry_type: 'point'; shapes: number[][][] };

    // Export — io/mapshaper-export.mjs
    exportFileContent(
      dataset: MapshaperDataset,
      opts: { format: string; [k: string]: unknown },
    ): Array<{ filename: string; content: string | Uint8Array | ArrayBuffer }>;

    // Snapshot pack/unpack — io/mapshaper-pack.mjs / mapshaper-unpack.mjs
    exportPackedDatasets(
      datasets: MapshaperDataset[],
      opts: { compact?: boolean; file?: string; [k: string]: unknown },
    ): Promise<Array<{ filename: string; content: Uint8Array }>>;

    /** Build the unpacked session object. Use {@link pack} to serialize, or
     *  inject extra fields (e.g. emap source IDs) before serializing. */
    exportDatasetsToPack(
      datasets: MapshaperDataset[],
      opts: { compact?: boolean; [k: string]: unknown },
    ): Promise<{ version: number; created: string; datasets: unknown[]; [k: string]: unknown }>;

    /** Serialize an arbitrary value to msgpack bytes. */
    pack(obj: unknown): Uint8Array;

    /** Restore a session object from msgpack bytes. Datasets are rebuilt into
     *  proper Mapshaper Dataset instances; non-standard fields (e.g. emap)
     *  are preserved on the returned object. */
    unpackSessionData(buf: Uint8Array): Promise<{
      version?: number;
      created?: string;
      datasets: MapshaperDataset[];
      [k: string]: unknown;
    }>;

    /** Reconstruct Dataset instances from an already-unpacked session object
     *  (the plain-object output of {@link exportDatasetsToPack}). Used by
     *  the Web Worker round-trip — skips the msgpack step. */
    restoreSessionData(obj: { datasets: unknown[]; [k: string]: unknown }): Promise<{
      datasets: MapshaperDataset[];
      [k: string]: unknown;
    }>;

    // Simplification / LOD
    getAvgSegment(arcs: ArcCollection): number;
    simplifyArcsFast(arcs: ArcCollection, segLen: number): ArcCollection;

    // Vertex editing — paths/mapshaper-vertex-utils.mjs
    findNearestVertices(point: [number, number], shape: number[][], arcs: ArcCollection): number[];
    snapVerticesToPoint(vertexIds: number[], point: [number, number], arcs: ArcCollection): void;
    vertexIsArcEndpoint(vertexId: number, arcs: ArcCollection): boolean;

    // Vertex editing — paths/mapshaper-arc-utils.mjs
    insertVertex(arcs: ArcCollection, vertexId: number, point: [number, number]): void;
    deleteVertex(arcs: ArcCollection, vertexId: number): void;
    appendEmptyArc(arcs: ArcCollection): void;
    appendVertex(arcs: ArcCollection, point: [number, number]): void;
    deleteLastArc(arcs: ArcCollection): void;
    findArcIdFromVertexId(vertexId: number, ii: Int32Array | Uint32Array): number;

    // Feature splitting / polygon mosaics
    insertCutPoints(
      points: Array<{ x: number; y: number; i: number }>,
      arcs: ArcCollection,
    ): unknown;
    remapDividedArcs(dataset: MapshaperDataset, map: unknown): void;
    NodeCollection: new (
      arcs: ArcCollection,
    ) => {
      setArcFilter(filter: (arcId: number) => boolean): void;
    };
    buildPolygonMosaic(nodes: { setArcFilter(filter: (arcId: number) => boolean): void }): {
      mosaic: number[][][];
    };
    getSelfIntersectionSplitter(nodes: {
      setArcFilter(filter: (arcId: number) => boolean): void;
    }): (ring: number[]) => number[][];
    findAnchorPoint(
      shape: number[][],
      arcs: ArcCollection,
    ): { x: number; y: number; distance?: number } | null;

    // Direct dataset construction — used by the Arrow module
    // (GeoParquet / GeoArrow) to build datasets from coordinate buffers
    // without a GeoJSON intermediate.
    /** Streaming importer; the class mapshaper's own format readers feed. */
    PathImporter: new (
      opts: Record<string, unknown>,
    ) => {
      startShape(properties?: Record<string, unknown>): void;
      importRing(points: Array<[number, number]>, isHole?: boolean): void;
      importLine(points: Array<[number, number]>): void;
      importPoints(points: Array<[number, number]>): void;
      done(): MapshaperDataset;
    };
    cleanPathsAfterImport(dataset: MapshaperDataset, opts: Record<string, unknown>): void;
    buildTopology(dataset: MapshaperDataset): void;
    DataTable: new (
      records: Array<Record<string, unknown>>,
    ) => import('./mapshaper-types').DataTable;
    exportPathData(
      shape: number[][] | null,
      arcs: ArcCollection,
      type: 'polygon' | 'polyline',
    ): {
      pathData: Array<{
        points: Array<[number, number]>;
        pointCount: number;
        area?: number;
        ids?: number[];
        bounds?: { xmin: number; ymin: number; xmax: number; ymax: number };
      }>;
      pointCount: number;
    };

    // Segment iteration / closest-point
    forEachSegmentInShape(
      shape: number[][],
      arcs: ArcCollection,
      cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
    ): void;
    findClosestPointOnSeg(
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number,
      snapArg: number,
    ): [number, number];
  }

  /** Subset of mapshaper.geom that emap consumes — geom/mapshaper-geom.mjs */
  interface MapshaperGeom {
    distance2D(x1: number, y1: number, x2: number, y2: number): number;
    getPointToShapeInfo(
      x: number,
      y: number,
      shape: number[][],
      arcs: ArcCollection,
    ): { distance: number };
    testPointInPolygon(x: number, y: number, shape: number[][], arcs: ArcCollection): boolean;
    /** Winding-number test against the ring formed by signed arc ids. */
    testPointInRing(x: number, y: number, ids: number[], arcs: ArcCollection): number;
    getShapeArea(shape: number[][], arcs: ArcCollection): number;
    getShapePerimeter(shape: number[][], arcs: ArcCollection): number;
  }

  const mapshaper: {
    internal: MapshaperInternal;
    geom: MapshaperGeom;
    applyCommands: (cmd: string, input: any, callback: (err: any, output: any) => void) => void;
  };
  export default mapshaper;
}
