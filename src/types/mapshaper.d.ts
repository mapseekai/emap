declare module 'mapshaper' {
  const mapshaper: {
    internal: {
      parseCommands: (cmd: string) => any[];
      runParsedCommands: (commands: any[], job: any, callback: (err: any, job: any) => void) => void;
      Job: any;
      getDatasetBounds: (dataset: any) => any;
      layerHasGeometry: (layer: any) => boolean;
      getLayerBounds: (layer: any, arcs: any) => any;
    };
    applyCommands: (cmd: string, input: any, callback: (err: any, output: any) => void) => void;
  };
  export default mapshaper;
}
