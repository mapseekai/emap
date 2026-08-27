import type * as maplibregl from 'maplibre-gl';

export type MapLibreService = MapLibreBasemapService | MapLibreOverlayService;

export interface MapLibreBasemapService {
  id: string;
  name: string;
  role: 'basemap';
  style: string | maplibregl.StyleSpecification;
}

export interface MapLibreOverlayServiceBase {
  id: string;
  name: string;
  role: 'overlay';
  visible?: boolean;
}

export interface MapLibreOverlayResourceService extends MapLibreOverlayServiceBase {
  sources: Record<string, maplibregl.SourceSpecification>;
  layers: maplibregl.LayerSpecification[];
  style?: never;
}

export interface MapLibreOverlayStyleService extends MapLibreOverlayServiceBase {
  style: string | maplibregl.StyleSpecification;
  sources?: never;
  layers?: never;
}

export type MapLibreOverlayService =
  | MapLibreOverlayResourceService
  | MapLibreOverlayStyleService;

export interface MapLibreIntegrationOptions {
  services?: readonly MapLibreService[];
  defaultBasemap?: string;
  mapOptions?: Omit<
    maplibregl.MapOptions,
    'container' | 'style' | 'center' | 'zoom' | 'interactive'
  >;
}

export interface MapLibreServiceState {
  id: string;
  active: boolean;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: Error;
}

export type MapLibreServiceChangeReason =
  | 'add'
  | 'update'
  | 'remove'
  | 'basemap'
  | 'visibility'
  | 'status';

export interface MapLibreServiceChangeEvent {
  serviceId: string;
  role: MapLibreService['role'];
  reason: MapLibreServiceChangeReason;
  state?: MapLibreServiceState;
}

export interface MapLibreServiceErrorEvent {
  serviceId?: string;
  phase: 'style' | 'source' | 'layer' | 'tile' | 'lifecycle';
  error: Error;
  fatal: boolean;
}

export interface MapLibreServiceEventMap {
  change: MapLibreServiceChangeEvent;
  error: MapLibreServiceErrorEvent;
}

export interface MapLibreServiceManager {
  addService(service: MapLibreService): Promise<void>;
  updateService(id: string, service: MapLibreService): Promise<void>;
  removeService(id: string): Promise<void>;
  setBasemap(id: string | null): Promise<void>;
  setOverlayVisibility(id: string, visible: boolean): Promise<void>;
  getServices(): readonly MapLibreService[];
  getServiceState(id: string): MapLibreServiceState | undefined;
  getMapLibreMap(): maplibregl.Map | null;
  on<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  off<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  once<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
}
