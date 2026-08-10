import type * as maplibregl from 'maplibre-gl';
import { EventDispatcher, type EventListener } from '../core/events';
import type {
  MapLibreIntegrationOptions,
  MapLibreOverlayService,
  MapLibreService,
  MapLibreServiceChangeEvent,
  MapLibreServiceEventMap,
  MapLibreServiceManager,
  MapLibreServiceState,
} from './maplibre-service';

/** @internal */
export interface MapLibreServiceHost {
  getCanvasContainer(): HTMLElement;
  getCRS(): string;
  reproject(crs: string): Promise<void>;
  getCenter(): [number, number];
  getZoom(): number;
  on(type: 'move' | 'resize' | 'crschange', listener: () => void): unknown;
  off(type: 'move' | 'resize' | 'crschange', listener: () => void): unknown;
}

/** @internal */
export type MapLibreModuleLoader = () => Promise<typeof import('maplibre-gl')>;

interface ServiceRecord {
  definition: MapLibreService;
  state: MapLibreServiceState;
  definitionRevision: number;
  operationRevision: number;
}

const SOURCE_OPTIONAL_LAYER_TYPES = new Set(['background', 'custom', 'sky']);

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }
  return value;
}

function cloneService(service: MapLibreService): MapLibreService {
  if (service.role === 'basemap') {
    return {
      ...service,
      style: typeof service.style === 'string' ? service.style : cloneValue(service.style),
    };
  }
  return {
    ...service,
    sources: cloneValue(service.sources),
    layers: cloneValue(service.layers),
  };
}

function cloneError(error: Error | undefined): Error | undefined {
  if (!error) return undefined;
  const copy = new Error(error.message);
  copy.name = error.name;
  return copy;
}

function cloneState(state: MapLibreServiceState): MapLibreServiceState {
  return { ...state, error: cloneError(state.error) };
}

function validateServiceId(id: string): void {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error('MapLibre service id must be a non-empty string');
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function abortError(message: string): DOMException {
  return new DOMException(message, 'AbortError');
}

function validateOverlayDefinition(
  service: MapLibreOverlayService,
  registry: ReadonlyMap<string, ServiceRecord>,
  replacingId?: string,
): void {
  if (!service.sources || typeof service.sources !== 'object' || Array.isArray(service.sources)) {
    throw new Error(`MapLibre overlay service "${service.id}" must define sources`);
  }
  if (!Array.isArray(service.layers)) {
    throw new Error(`MapLibre overlay service "${service.id}" must define layers`);
  }

  const sourceIds = new Set(Object.keys(service.sources));
  const layerIds = new Set<string>();
  for (const [sourceId] of Object.entries(service.sources)) {
    if (sourceId.trim() === '') throw new Error('MapLibre overlay source id must be a non-empty string');
  }

  for (const layer of service.layers) {
    if (!layer || typeof layer !== 'object' || typeof layer.id !== 'string' || layer.id.trim() === '') {
      throw new Error('MapLibre overlay layer id must be a non-empty string');
    }
    if (layerIds.has(layer.id)) {
      throw new Error(`MapLibre overlay layer "${layer.id}" already exists`);
    }
    layerIds.add(layer.id);

    const layerRecord = layer as unknown as Record<string, unknown>;
    if (Object.hasOwn(layerRecord, 'source')) {
      const sourceId = layerRecord.source;
      if (typeof sourceId !== 'string' || !sourceIds.has(sourceId)) {
        throw new Error(
          `MapLibre overlay layer "${layer.id}" references unknown source "${String(sourceId)}"`,
        );
      }
    } else if (!SOURCE_OPTIONAL_LAYER_TYPES.has(layer.type)) {
      throw new Error(`MapLibre overlay layer "${layer.id}" requires a source`);
    }
  }

  for (const [serviceId, record] of registry) {
    if (serviceId === replacingId || record.definition.role !== 'overlay') continue;
    for (const sourceId of Object.keys(record.definition.sources)) {
      if (sourceIds.has(sourceId)) {
        throw new Error(`MapLibre overlay source "${sourceId}" already exists`);
      }
    }
    for (const layer of record.definition.layers) {
      if (layerIds.has(layer.id)) {
        throw new Error(`MapLibre overlay layer "${layer.id}" already exists`);
      }
    }
  }
}

function validateService(
  service: MapLibreService,
  registry: ReadonlyMap<string, ServiceRecord>,
  replacingId?: string,
): void {
  if (!service || typeof service !== 'object') throw new Error('MapLibre service must be an object');
  validateServiceId(service.id);
  if (typeof service.name !== 'string' || service.name.trim() === '') {
    throw new Error(`MapLibre service "${service.id}" must have a name`);
  }
  const role = (service as { role?: unknown }).role;
  if (role !== 'basemap' && role !== 'overlay') {
    throw new Error(`MapLibre service "${service.id}" has an invalid role`);
  }
  if (role === 'overlay') {
    validateOverlayDefinition(service as MapLibreOverlayService, registry, replacingId);
  }
}

/** @internal */
export class MapLibreServiceManagerImpl extends EventDispatcher implements MapLibreServiceManager {
  private _registry = new Map<string, ServiceRecord>();
  private _definitionRevision = 0;
  private _basemapRevision = 0;

  constructor(
    _host: MapLibreServiceHost,
    _options: MapLibreIntegrationOptions = {},
    _loadMapLibre: MapLibreModuleLoader = () => import('maplibre-gl'),
  ) {
    super();
    for (const service of _options.services ?? []) this._register(service);
    if (_options.defaultBasemap !== undefined) this._validateDefaultBasemap(_options.defaultBasemap);
  }

  on<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  on(type: string, listener: EventListener): this {
    return super.on(type, listener);
  }

  off<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  off(type: string, listener: EventListener): this {
    return super.off(type, listener);
  }

  once<K extends keyof MapLibreServiceEventMap>(
    type: K,
    listener: (event: { type: K } & MapLibreServiceEventMap[K]) => void,
  ): this;
  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  once(type: string, listener: EventListener): this {
    return super.once(type, listener);
  }

  fire<K extends keyof MapLibreServiceEventMap>(type: K, data: MapLibreServiceEventMap[K]): this;
  fire<T = Record<string, unknown>>(type: string, data?: T): this;
  fire(type: string, data?: Record<string, unknown>): this {
    if (type === 'error' && !Object.hasOwn(data ?? {}, 'phase')) {
      return super.fire('error', {
        phase: 'lifecycle',
        fatal: false,
        error: toError(data?.error),
      });
    }
    return super.fire(type, data);
  }

  async addService(service: MapLibreService): Promise<void> {
    const record = this._register(service);
    this._emitChange(record.definition, 'add', record.state);
  }

  async updateService(id: string, service: MapLibreService): Promise<void> {
    const record = this._requireService(id);
    if (service.id !== id) throw new Error(`MapLibre service id must match "${id}"`);
    if (service.role !== record.definition.role) throw new Error('MapLibre service role cannot change');
    validateService(service, this._registry, id);

    const replacement: ServiceRecord = {
      definition: cloneService(service),
      state: cloneState(record.state),
      definitionRevision: ++this._definitionRevision,
      operationRevision: record.operationRevision + 1,
    };
    this._registry.set(id, replacement);
    this._emitChange(replacement.definition, 'update', replacement.state);
  }

  async removeService(id: string): Promise<void> {
    const record = this._requireService(id);
    record.operationRevision++;
    this._registry.delete(id);
    this._emitChange(record.definition, 'remove');
  }

  async setBasemap(id: string | null): Promise<void> {
    const next = id === null ? undefined : this._requireBasemap(id);
    const current = this._activeBasemap();
    if (current?.definition.id === next?.definition.id) return;

    const revision = ++this._basemapRevision;
    if (current) this._setActive(current, false);
    if (next) this._setActive(next, true);

    if (current) {
      this._emitChange(current.definition, 'basemap', current.state);
      if (revision !== this._basemapRevision) throw abortError('MapLibre basemap request was superseded');
    }
    if (next) {
      this._emitChange(next.definition, 'basemap', next.state);
      if (revision !== this._basemapRevision) throw abortError('MapLibre basemap request was superseded');
    }
  }

  async setOverlayVisibility(id: string, visible: boolean): Promise<void> {
    const record = this._requireService(id);
    if (record.definition.role !== 'overlay') {
      throw new Error(`MapLibre service "${id}" is not an overlay`);
    }
    if (record.state.active === visible) return;
    this._setActive(record, visible);
    this._emitChange(record.definition, 'visibility', record.state);
  }

  getServices(): readonly MapLibreService[] {
    return [...this._registry.values()].map((record) => cloneService(record.definition));
  }

  getServiceState(id: string): MapLibreServiceState | undefined {
    const record = this._registry.get(id);
    return record ? cloneState(record.state) : undefined;
  }

  getMapLibreMap(): maplibregl.Map | null {
    return null;
  }

  private _register(service: MapLibreService): ServiceRecord {
    validateService(service, this._registry);
    if (this._registry.has(service.id)) {
      throw new Error(`MapLibre service "${service.id}" already exists`);
    }
    const definition = cloneService(service);
    const record: ServiceRecord = {
      definition,
      state: {
        id: definition.id,
        active: definition.role === 'overlay' && definition.visible === true,
        status: 'idle',
      },
      definitionRevision: ++this._definitionRevision,
      operationRevision: 0,
    };
    this._registry.set(definition.id, record);
    return record;
  }

  private _validateDefaultBasemap(id: string): void {
    const record = this._registry.get(id);
    if (!record) throw new Error(`MapLibre default basemap "${id}" does not exist`);
    if (record.definition.role !== 'basemap') {
      throw new Error(`MapLibre default basemap "${id}" is not a basemap`);
    }
  }

  private _requireService(id: string): ServiceRecord {
    const record = this._registry.get(id);
    if (!record) throw new Error(`MapLibre service "${id}" does not exist`);
    return record;
  }

  private _requireBasemap(id: string): ServiceRecord {
    const record = this._requireService(id);
    if (record.definition.role !== 'basemap') {
      throw new Error(`MapLibre service "${id}" is not a basemap`);
    }
    return record;
  }

  private _activeBasemap(): ServiceRecord | undefined {
    return [...this._registry.values()].find(
      (record) => record.definition.role === 'basemap' && record.state.active,
    );
  }

  private _setActive(record: ServiceRecord, active: boolean): void {
    record.operationRevision++;
    record.state = { id: record.definition.id, active, status: 'idle' };
  }

  private _emitChange(
    definition: MapLibreService,
    reason: MapLibreServiceChangeEvent['reason'],
    state?: MapLibreServiceState,
  ): void {
    this.fire('change', {
      serviceId: definition.id,
      role: definition.role,
      reason,
      state: state && cloneState(state),
    });
  }
}

/** @internal */
export function createMapLibreServiceManager(
  host: MapLibreServiceHost,
  options: MapLibreIntegrationOptions = {},
  loadMapLibre: MapLibreModuleLoader = () => import('maplibre-gl'),
): MapLibreServiceManagerImpl {
  return new MapLibreServiceManagerImpl(host, options, loadMapLibre);
}
