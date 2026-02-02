export interface Source {
  id: string;
  type: 'topology' | 'geojson';
  load(): Promise<void>;
  getExtent(): any;
}

export interface TopologySource extends Source {
  type: 'topology';
  getArcs(): any[];
  getLayers(): any[];
}
