declare module 'mapshaper' {
  const mapshaper: {
    internal: {
      parseCommands: (cmd: string) => any[];
      runParsedCommands: (commands: any[], job: any, callback: (err: any, job: any) => void) => void;
      Job: any;
      getDatasetBounds: (dataset: any) => any;
      layerHasGeometry: (layer: any) => boolean;
      getLayerBounds: (layer: any, arcs: any) => any;
      getAvgSegment: (arcs: any) => number;
      simplifyArcsFast: (arcs: any, segLen: number) => any;
      findNearestVertices: (point: [number, number], shape: any, arcs: any) => number[];
      snapVerticesToPoint: (vertexIds: number[], point: [number, number], arcs: any) => void;
    };
    geom: {
      distance2D: (x1: number, y1: number, x2: number, y2: number) => number;
      getPointToShapeInfo: (x: number, y: number, shape: any, arcs: any) => { distance: number };
      testPointInPolygon: (x: number, y: number, shape: any, arcs: any) => boolean;
    };
    applyCommands: (cmd: string, input: any, callback: (err: any, output: any) => void) => void;
  };
  export default mapshaper;
}
