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

    // Export — io/mapshaper-export.mjs
    exportFileContent(
      dataset: MapshaperDataset,
      opts: { format: string;[k: string]: unknown },
    ): Array<{ filename: string; content: string | Uint8Array | ArrayBuffer }>;

    // Snapshot pack/unpack — io/mapshaper-pack.mjs / mapshaper-unpack.mjs
    exportPackedDatasets(
      datasets: MapshaperDataset[],
      opts: { compact?: boolean; file?: string;[k: string]: unknown },
    ): Promise<Array<{ filename: string; content: Uint8Array }>>;

    /** Build the unpacked session object. Use {@link pack} to serialize, or
     *  inject extra fields (e.g. emap source IDs) before serializing. */
    exportDatasetsToPack(
      datasets: MapshaperDataset[],
      opts: { compact?: boolean;[k: string]: unknown },
    ): Promise<{ version: number; created: string; datasets: unknown[];[k: string]: unknown }>;

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

    // Segment iteration / closest-point
    forEachSegmentInShape(
      shape: number[][],
      arcs: ArcCollection,
      cb: (i: number, j: number, xx: Float64Array, yy: Float64Array) => void,
    ): void;
    findClosestPointOnSeg(
      px: number, py: number,
      ax: number, ay: number,
      bx: number, by: number,
      snapArg: number,
    ): [number, number];
  }

  /** Subset of mapshaper.geom that emap consumes — geom/mapshaper-geom.mjs */
  interface MapshaperGeom {
    distance2D(x1: number, y1: number, x2: number, y2: number): number;
    getPointToShapeInfo(
      x: number, y: number,
      shape: number[][],
      arcs: ArcCollection,
    ): { distance: number };
    testPointInPolygon(
      x: number, y: number,
      shape: number[][],
      arcs: ArcCollection,
    ): boolean;
  }

  const mapshaper: {
    internal: MapshaperInternal;
    geom: MapshaperGeom;
    applyCommands: (cmd: string, input: any, callback: (err: any, output: any) => void) => void;
  };
  export default mapshaper;
}
