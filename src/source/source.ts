import { EventDispatcher } from '../core/events';
import type { ArcCollection, MapshaperDataset } from '../types/mapshaper-types';
import type { DisplayArcs } from './display-arcs';
import type { Bounds } from '../geo/bounds';

export interface Source extends EventDispatcher {
  id: string;
  type: 'topology' | 'geojson';
  getExtent(): Bounds;
}

export interface TopologySource extends Source {
  type: 'topology';
  getArcs(): ArcCollection | undefined;
  getLayers(): any[];
  getDataset(): MapshaperDataset | undefined;
  getDisplayArcs(): DisplayArcs | null;
  getCRS?(): string;
  reproject?(targetCrs: string): Promise<void>;
}
