import type * as maplibregl from 'maplibre-gl';
import { EventDispatcher, type EventListener } from '../core/events';
import type {
  MapLibreIntegrationOptions,
  MapLibreOverlayService,
  MapLibreService,
  MapLibreServiceChangeEvent,
  MapLibreServiceErrorEvent,
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
  ownedSources: Map<string, OwnedResource>;
  ownedLayers: Map<string, OwnedResource>;
  installedDefinition?: MapLibreOverlayService;
}

interface OwnedResource {
  generation: number;
  handle: unknown;
}

interface MutationContext {
  serviceId: string;
  phase: 'source' | 'layer';
  resourceId: string;
  error?: Error;
}

const EMPTY_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [],
};

const MAP_DEFAULTS = {
  attributionControl: false,
  maxPitch: 0,
  renderWorldCopies: true,
} as const;

const SOURCE_OPTIONAL_LAYER_TYPES = new Set(['background', 'custom', 'sky']);

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        cloneValue(item),
      ]),
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
    if (sourceId.trim() === '')
      throw new Error('MapLibre overlay source id must be a non-empty string');
  }

  for (const layer of service.layers) {
    if (
      !layer ||
      typeof layer !== 'object' ||
      typeof layer.id !== 'string' ||
      layer.id.trim() === ''
    ) {
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
  if (!service || typeof service !== 'object')
    throw new Error('MapLibre service must be an object');
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
  private _map: maplibregl.Map | null = null;
  private _mapPromise: Promise<maplibregl.Map> | null = null;
  private _container: HTMLElement | null = null;
  private _styleReady: Promise<void> | null = null;
  private _resolveStyleReady: (() => void) | null = null;
  private _rejectStyleReady: ((error: Error) => void) | null = null;
  private _styleIsReady = false;
  private _styleGeneration = 0;
  private _destroyed = false;
  private _suspended = false;
  private _mutationContext: MutationContext | null = null;
  private _errorPhases = new WeakMap<Error, MapLibreServiceErrorEvent['phase']>();
  private _reconciliationJobs = new WeakMap<
    ServiceRecord,
    { revision: number; promise: Promise<void> }
  >();

  constructor(
    private _host: MapLibreServiceHost,
    private _options: MapLibreIntegrationOptions = {},
    private _loadMapLibre: MapLibreModuleLoader = () => import('maplibre-gl'),
  ) {
    super();
    for (const service of _options.services ?? []) this._register(service);
    if (_options.defaultBasemap !== undefined)
      this._validateDefaultBasemap(_options.defaultBasemap);
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
    if (record.definition.role === 'overlay' && record.state.active) {
      await this._startOverlayReconciliation(record, record.operationRevision);
    }
  }

  async updateService(id: string, service: MapLibreService): Promise<void> {
    const record = this._requireService(id);
    if (service.id !== id) throw new Error(`MapLibre service id must match "${id}"`);
    if (service.role !== record.definition.role)
      throw new Error('MapLibre service role cannot change');
    validateService(service, this._registry, id);

    record.operationRevision++;
    const previousDefinition = cloneService(record.definition);
    const previousDefinitionRevision = record.definitionRevision;
    const replacement: ServiceRecord = {
      definition: cloneService(service),
      state: {
        id,
        active: record.state.active,
        status: record.state.active ? 'idle' : record.state.status,
      },
      definitionRevision: ++this._definitionRevision,
      operationRevision: record.operationRevision,
      ownedSources: new Map(record.ownedSources),
      ownedLayers: new Map(record.ownedLayers),
      installedDefinition: record.installedDefinition,
    };
    this._registry.set(id, replacement);
    this._emitChange(replacement.definition, 'update', replacement.state);
    this._assertCurrentOperation(replacement, replacement.operationRevision);
    if (replacement.definition.role === 'overlay' && replacement.state.active) {
      await this._updateActiveOverlay(
        replacement,
        previousDefinition as MapLibreOverlayService,
        previousDefinitionRevision,
        replacement.operationRevision,
      );
    }
  }

  async removeService(id: string): Promise<void> {
    const record = this._requireService(id);
    this._setActive(record, false);
    const operationRevision = record.operationRevision;
    this._syncVisibility();
    if (record.definition.role === 'overlay' && this._map) {
      try {
        await this._removeOverlayResources(record, operationRevision);
        this._assertCurrentOperation(record, operationRevision);
      } catch (value) {
        this._handleTransitionFailure(record, operationRevision, value);
      }
    }
    this._assertCurrentOperation(record, operationRevision);
    this._registry.delete(id);
    this._emitChange(record.definition, 'remove');
    this._syncVisibility();
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
      if (revision !== this._basemapRevision)
        throw abortError('MapLibre basemap request was superseded');
    }
    if (next) {
      this._emitChange(next.definition, 'basemap', next.state);
      if (revision !== this._basemapRevision)
        throw abortError('MapLibre basemap request was superseded');
    }
  }

  async setOverlayVisibility(id: string, visible: boolean): Promise<void> {
    const record = this._requireService(id);
    if (record.definition.role !== 'overlay') {
      throw new Error(`MapLibre service "${id}" is not an overlay`);
    }
    if (record.state.active === visible) {
      const job = this._reconciliationJobs.get(record);
      if (visible && job?.revision === record.operationRevision) await job.promise;
      return;
    }
    this._setActive(record, visible);
    const operationRevision = record.operationRevision;
    this._emitChange(record.definition, 'visibility', record.state);
    this._assertCurrentOperation(record, operationRevision);
    if (visible) {
      await this._startOverlayReconciliation(record, operationRevision);
    } else {
      this._syncVisibility();
      try {
        this._setStatus(record, operationRevision, 'loading');
        if (this._map) {
          await this._removeOverlayResources(record, operationRevision);
          this._assertCurrentOperation(record, operationRevision);
        }
        this._setStatus(record, operationRevision, 'ready');
        this._syncVisibility();
      } catch (error) {
        this._handleTransitionFailure(record, operationRevision, error);
      }
    }
  }

  getServices(): readonly MapLibreService[] {
    return [...this._registry.values()].map((record) => cloneService(record.definition));
  }

  getServiceState(id: string): MapLibreServiceState | undefined {
    const record = this._registry.get(id);
    return record ? cloneState(record.state) : undefined;
  }

  getMapLibreMap(): maplibregl.Map | null {
    return this._map;
  }

  /** @internal */
  async initialize(): Promise<void> {
    if (!this._hasActiveOverlay()) return;
    await this._ensureWebMercator();
    await this._ensureMap(EMPTY_STYLE);
    try {
      await this._waitForStyleReady();
    } catch (value) {
      const error = toError(value);
      for (const serviceId of [...this._registry.keys()]) {
        const record = this._registry.get(serviceId);
        if (!record || record.definition.role !== 'overlay' || !record.state.active) continue;
        const operationRevision = record.operationRevision;
        try {
          this._publishTransitionFailure(record, operationRevision, error);
        } catch (publishValue) {
          const publishError = toError(publishValue);
          if (
            publishError.name === 'AbortError' &&
            !this._isCurrentOperation(record, operationRevision)
          ) {
            continue;
          }
          throw publishError;
        }
      }
      throw error;
    }
    await this._reconcileVisibleOverlays(this._styleGeneration, true);
    this._syncVisibility();
  }

  /** @internal */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const record of this._registry.values()) record.operationRevision++;
    this._rejectPendingStyle(abortError('MapLibre service manager was destroyed'));

    this._host.off('move', this._handleMove);
    this._host.off('resize', this._handleResize);
    this._host.off('crschange', this._handleCrsChange);
    if (this._map) {
      this._map.off('style.load', this._handleStyleLoad);
      this._map.off('error', this._handleMapError);
      this._map.remove();
    }
    this._container?.remove();
    this._container = null;
    this._map = null;
    this._mapPromise = null;
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
      ownedSources: new Map(),
      ownedLayers: new Map(),
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

  private _startOverlayReconciliation(
    record: ServiceRecord,
    operationRevision: number,
    ensureProjection = true,
  ): Promise<void> {
    const existing = this._reconciliationJobs.get(record);
    if (existing?.revision === operationRevision) return existing.promise;
    const job = {
      revision: operationRevision,
      promise: Promise.resolve(),
    };
    job.promise = (async () => {
      try {
        this._setStatus(record, operationRevision, 'loading');
        if (ensureProjection) {
          await this._ensureWebMercator();
          this._assertCurrentOperation(record, operationRevision);
        }
        await this._ensureMap(EMPTY_STYLE);
        this._assertCurrentOperation(record, operationRevision);
        await this._waitForStyleReady();
        this._assertCurrentOperation(record, operationRevision);
        const generation = this._styleGeneration;
        await this._reconcileOverlayForGeneration(record, operationRevision, generation);
        this._assertCurrentOperation(record, operationRevision);
        this._setStatus(record, operationRevision, 'ready');
        this._syncVisibility();
      } catch (error) {
        this._handleTransitionFailure(record, operationRevision, error);
      } finally {
        if (this._reconciliationJobs.get(record) === job) {
          this._reconciliationJobs.delete(record);
        }
      }
    })();
    this._reconciliationJobs.set(record, job);
    return job.promise;
  }

  private async _updateActiveOverlay(
    record: ServiceRecord,
    previousDefinition: MapLibreOverlayService,
    previousDefinitionRevision: number,
    operationRevision: number,
  ): Promise<void> {
    try {
      this._setStatus(record, operationRevision, 'loading');
      await this._waitForStyleReady();
      this._assertCurrentOperation(record, operationRevision);
      await this._removeOverlayResources(record, operationRevision, previousDefinition);
      this._assertCurrentOperation(record, operationRevision);
      await this._reconcileOverlayForGeneration(record, operationRevision, this._styleGeneration);
      this._setStatus(record, operationRevision, 'ready');
    } catch (error) {
      const originalError = toError(error);
      if (
        originalError.name !== 'AbortError' &&
        this._isCurrentOperation(record, operationRevision)
      ) {
        record.definition = cloneService(previousDefinition);
        record.definitionRevision = previousDefinitionRevision;
        try {
          await this._removeOverlayResources(record, operationRevision);
          await this._reconcileOverlayForGeneration(
            record,
            operationRevision,
            this._styleGeneration,
          );
        } catch (rollbackValue) {
          this._handleTransitionFailure(record, operationRevision, rollbackValue);
        }
        this._emitChange(record.definition, 'update', record.state);
        this._assertCurrentOperation(record, operationRevision);
        this._setStatus(record, operationRevision, 'ready');
        this._emitFatalError(record.definition.id, originalError);
        throw originalError;
      }
      this._handleTransitionFailure(record, operationRevision, originalError);
    }
  }

  private async _reconcileVisibleOverlays(
    generation: number,
    publishStatus = false,
  ): Promise<void> {
    for (const serviceId of [...this._registry.keys()]) {
      const record = this._registry.get(serviceId);
      if (!record) continue;
      if (record.definition.role !== 'overlay' || !record.state.active) continue;
      const operationRevision = record.operationRevision;
      try {
        if (publishStatus) this._setStatus(record, operationRevision, 'loading');
        await this._reconcileOverlayForGeneration(record, operationRevision, generation);
        this._assertCurrentOperation(record, operationRevision);
        if (publishStatus) this._setStatus(record, operationRevision, 'ready');
      } catch (value) {
        const error = toError(value);
        if (
          error.name === 'AbortError' &&
          (!this._isCurrentOperation(record, operationRevision) || !record.state.active)
        ) {
          continue;
        }
        this._handleTransitionFailure(record, operationRevision, error);
      }
    }
  }

  private async _reconcileOverlayForGeneration(
    record: ServiceRecord,
    operationRevision: number,
    generation: number,
  ): Promise<void> {
    this._assertCurrentOperation(record, operationRevision);
    if (!record.state.active || record.definition.role !== 'overlay') {
      throw abortError(`MapLibre service "${record.definition.id}" request was superseded`);
    }
    if (generation !== this._styleGeneration || !this._styleIsReady) {
      throw abortError('MapLibre style generation was superseded');
    }
    this._installOverlay(record, operationRevision, generation);
  }

  private _installOverlay(
    record: ServiceRecord,
    operationRevision: number,
    generation: number,
  ): void {
    const map = this._map;
    if (!map || record.definition.role !== 'overlay') {
      throw new Error('MapLibre overlay runtime is unavailable');
    }
    const definition = record.definition;
    const addedSourceIds: string[] = [];
    const addedLayerIds: string[] = [];
    try {
      for (const [sourceId, source] of Object.entries(definition.sources)) {
        this._assertCurrentOperation(record, operationRevision);
        const existing = map.getSource(sourceId);
        const owned = record.ownedSources.get(sourceId);
        if (existing !== undefined) {
          if (owned?.generation === generation && owned.handle === existing) continue;
          throw this._phaseError(
            'source',
            `MapLibre overlay source "${sourceId}" collides with an unmanaged resource`,
          );
        }
        try {
          this._mutateResource(
            record.definition.id,
            'source',
            sourceId,
            () => {
              map.addSource(sourceId, source);
            },
            () => map.getSource(sourceId) !== undefined,
          );
        } catch (error) {
          const handle = map.getSource(sourceId);
          if (handle !== undefined) {
            record.ownedSources.set(sourceId, { generation, handle });
            addedSourceIds.push(sourceId);
          }
          throw error;
        }
        this._assertCurrentOperation(record, operationRevision);
        const handle = map.getSource(sourceId);
        if (handle === undefined)
          throw new Error(`MapLibre overlay source "${sourceId}" was not added`);
        record.ownedSources.set(sourceId, { generation, handle });
        addedSourceIds.push(sourceId);
      }

      for (const layer of definition.layers) {
        this._assertCurrentOperation(record, operationRevision);
        const existing = map.getLayer(layer.id);
        const owned = record.ownedLayers.get(layer.id);
        if (existing !== undefined) {
          if (owned?.generation === generation && owned.handle === existing) continue;
          throw this._phaseError(
            'layer',
            `MapLibre overlay layer "${layer.id}" collides with an unmanaged resource`,
          );
        }
        const beforeId = this._findFollowingManagedLayer(record, layer.id, generation);
        try {
          this._mutateResource(
            record.definition.id,
            'layer',
            layer.id,
            () => {
              map.addLayer(layer, beforeId);
            },
            () => map.getLayer(layer.id) !== undefined,
          );
        } catch (error) {
          const handle = map.getLayer(layer.id);
          if (handle !== undefined) {
            record.ownedLayers.set(layer.id, { generation, handle });
            addedLayerIds.push(layer.id);
          }
          throw error;
        }
        this._assertCurrentOperation(record, operationRevision);
        const handle = map.getLayer(layer.id);
        if (handle === undefined)
          throw new Error(`MapLibre overlay layer "${layer.id}" was not added`);
        record.ownedLayers.set(layer.id, { generation, handle });
        addedLayerIds.push(layer.id);
      }
      record.installedDefinition = cloneService(definition) as MapLibreOverlayService;
    } catch (error) {
      try {
        this._rollbackAddedResources(record, addedLayerIds, addedSourceIds);
      } catch {
        // Retained ownership lets a later hide, removal, or rollback retry cleanup.
      }
      throw error;
    }
  }

  private async _removeOverlayResources(
    record: ServiceRecord,
    operationRevision?: number,
    definition = record.installedDefinition,
  ): Promise<void> {
    const map = this._map;
    if (!map) return;
    const assertCurrent = () => {
      if (operationRevision !== undefined) this._assertCurrentOperation(record, operationRevision);
    };
    const orderedLayerIds = definition?.layers.map((layer) => layer.id) ?? [
      ...record.ownedLayers.keys(),
    ];
    const remainingLayerIds = [...record.ownedLayers.keys()].filter(
      (id) => !orderedLayerIds.includes(id),
    );
    for (const layerId of [...remainingLayerIds, ...orderedLayerIds].reverse()) {
      const owned = record.ownedLayers.get(layerId);
      if (!owned) continue;
      assertCurrent();
      const current = map.getLayer(layerId);
      if (current !== undefined && current !== owned.handle) {
        throw this._phaseError(
          'layer',
          `MapLibre overlay layer "${layerId}" is no longer manager-owned`,
        );
      }
      if (current !== undefined) {
        this._mutateResource(
          record.definition.id,
          'layer',
          layerId,
          () => {
            map.removeLayer(layerId);
          },
          () => map.getLayer(layerId) === undefined,
        );
      }
      assertCurrent();
      record.ownedLayers.delete(layerId);
    }

    const orderedSourceIds = definition
      ? Object.keys(definition.sources)
      : [...record.ownedSources.keys()];
    const remainingSourceIds = [...record.ownedSources.keys()].filter(
      (id) => !orderedSourceIds.includes(id),
    );
    for (const sourceId of [...remainingSourceIds, ...orderedSourceIds]) {
      const owned = record.ownedSources.get(sourceId);
      if (!owned) continue;
      assertCurrent();
      const current = map.getSource(sourceId);
      if (current !== undefined && current !== owned.handle) {
        throw this._phaseError(
          'source',
          `MapLibre overlay source "${sourceId}" is no longer manager-owned`,
        );
      }
      if (current !== undefined) {
        this._mutateResource(
          record.definition.id,
          'source',
          sourceId,
          () => {
            map.removeSource(sourceId);
          },
          () => map.getSource(sourceId) === undefined,
        );
      }
      assertCurrent();
      record.ownedSources.delete(sourceId);
    }
    record.installedDefinition = undefined;
  }

  private _findFollowingManagedLayer(
    targetRecord: ServiceRecord,
    layerId: string,
    generation: number,
  ): string | undefined {
    const map = this._map;
    if (!map) return undefined;
    const desired: Array<{ record: ServiceRecord; id: string }> = [];
    for (const record of this._registry.values()) {
      if (record.definition.role !== 'overlay' || !record.state.active) continue;
      for (const layer of record.definition.layers) desired.push({ record, id: layer.id });
    }
    const index = desired.findIndex((item) => item.record === targetRecord && item.id === layerId);
    for (const item of desired.slice(index + 1)) {
      const owned = item.record.ownedLayers.get(item.id);
      const current = map.getLayer(item.id);
      if (owned?.generation === generation && owned.handle === current) return item.id;
    }
    return undefined;
  }

  private _mutateResource(
    serviceId: string,
    phase: 'source' | 'layer',
    resourceId: string,
    mutate: () => void,
    verify: () => boolean,
  ): void {
    const context: MutationContext = { serviceId, phase, resourceId };
    this._mutationContext = context;
    try {
      mutate();
      if (context.error) throw context.error;
      if (!verify()) {
        throw new Error(`MapLibre ${phase} mutation failed its postcondition for "${resourceId}"`);
      }
    } catch (value) {
      const error = toError(value);
      this._errorPhases.set(error, phase);
      throw error;
    } finally {
      if (this._mutationContext === context) this._mutationContext = null;
    }
  }

  private _rollbackAddedResources(
    record: ServiceRecord,
    layerIds: readonly string[],
    sourceIds: readonly string[],
  ): void {
    const map = this._map;
    if (!map) return;
    for (const layerId of [...layerIds].reverse()) {
      const owned = record.ownedLayers.get(layerId);
      if (!owned) continue;
      const current = map.getLayer(layerId);
      if (current !== undefined && current !== owned.handle) {
        throw this._phaseError(
          'layer',
          `MapLibre overlay layer "${layerId}" is no longer manager-owned`,
        );
      }
      if (current !== undefined) {
        this._mutateResource(
          record.definition.id,
          'layer',
          layerId,
          () => {
            map.removeLayer(layerId);
          },
          () => map.getLayer(layerId) === undefined,
        );
      }
      if (map.getLayer(layerId) === undefined) record.ownedLayers.delete(layerId);
    }
    for (const sourceId of [...sourceIds].reverse()) {
      const owned = record.ownedSources.get(sourceId);
      if (!owned) continue;
      const current = map.getSource(sourceId);
      if (current !== undefined && current !== owned.handle) {
        throw this._phaseError(
          'source',
          `MapLibre overlay source "${sourceId}" is no longer manager-owned`,
        );
      }
      if (current !== undefined) {
        this._mutateResource(
          record.definition.id,
          'source',
          sourceId,
          () => {
            map.removeSource(sourceId);
          },
          () => map.getSource(sourceId) === undefined,
        );
      }
      if (map.getSource(sourceId) === undefined) record.ownedSources.delete(sourceId);
    }
  }

  private async _ensureWebMercator(): Promise<void> {
    if (this._destroyed) throw abortError('MapLibre service manager was destroyed');
    const wasSuspended = this._suspended || !this._isWebMercator(this._host.getCRS());
    if (!this._isWebMercator(this._host.getCRS())) {
      await this._host.reproject('webmercator');
      if (this._destroyed) throw abortError('MapLibre service manager was destroyed');
    }
    this._suspended = !this._isWebMercator(this._host.getCRS());
    if (wasSuspended && !this._suspended && this._map && this._hasActiveService()) {
      this._map.resize();
      this._syncCamera();
    }
  }

  private async _ensureMap(
    initialStyle: string | maplibregl.StyleSpecification,
  ): Promise<maplibregl.Map> {
    if (this._map) return this._map;
    if (this._mapPromise) return this._mapPromise;
    this._mapPromise = (async () => {
      const maplibre = await this._loadMapLibre();
      if (this._destroyed) throw abortError('MapLibre service manager was destroyed');
      if (!this._hasActiveOverlay()) {
        throw abortError('MapLibre runtime request was superseded');
      }

      let container: HTMLElement | null = null;
      let map: maplibregl.Map | null = null;
      try {
        const canvasContainer = this._host.getCanvasContainer();
        container = document.createElement('div');
        container.classList.add('emap-maplibre', 'emap-basemap');
        container.style.position = 'absolute';
        container.style.inset = '0';
        container.style.zIndex = '0';
        container.style.pointerEvents = 'none';
        const firstCanvas = [...canvasContainer.children].find(
          (child): child is HTMLCanvasElement => child instanceof HTMLCanvasElement,
        );
        canvasContainer.insertBefore(container, firstCanvas ?? canvasContainer.firstChild);

        this._container = container;
        this._styleReady = new Promise<void>((resolve, reject) => {
          this._resolveStyleReady = resolve;
          this._rejectStyleReady = reject;
        });
        void this._styleReady.catch(() => undefined);
        map = new maplibre.Map({
          ...MAP_DEFAULTS,
          ...this._options.mapOptions,
          container,
          style: initialStyle,
          center: this._host.getCenter(),
          zoom: this._host.getZoom(),
          interactive: false,
        });
        this._map = map;
        map.on('style.load', this._handleStyleLoad);
        map.on('error', this._handleMapError);
        this._host.on('move', this._handleMove);
        this._host.on('resize', this._handleResize);
        this._host.on('crschange', this._handleCrsChange);
        this._syncVisibility();
        return map;
      } catch (value) {
        const error = toError(value);
        this._host.off('move', this._handleMove);
        this._host.off('resize', this._handleResize);
        this._host.off('crschange', this._handleCrsChange);
        if (map) {
          map.off('style.load', this._handleStyleLoad);
          map.off('error', this._handleMapError);
          try {
            map.remove();
          } catch {
            // Preserve the setup error that made the runtime unusable.
          }
        }
        container?.remove();
        if (this._container === container) this._container = null;
        if (this._map === map) this._map = null;
        this._rejectPendingStyle(error);
        this._styleReady = null;
        this._styleIsReady = false;
        throw error;
      }
    })();
    try {
      return await this._mapPromise;
    } catch (error) {
      this._mapPromise = null;
      throw error;
    }
  }

  private async _waitForStyleReady(): Promise<void> {
    if (this._styleIsReady) return;
    if (!this._styleReady) throw new Error('MapLibre style readiness is unavailable');
    await this._styleReady;
  }

  private _handleStyleLoad = (): void => {
    if (this._destroyed || this._styleIsReady) return;
    this._styleIsReady = true;
    this._styleGeneration++;
    this._resolveStyleReady?.();
    this._resolveStyleReady = null;
    this._rejectStyleReady = null;
  };

  private _handleMapError = (event?: unknown): void => {
    const error = toError((event as { error?: unknown } | undefined)?.error ?? event);
    if (this._mutationContext) {
      this._mutationContext.error = error;
      this._errorPhases.set(error, this._mutationContext.phase);
      return;
    }
    if (this._styleIsReady) {
      this.fire('error', { phase: 'tile', fatal: false, error });
      return;
    }
    this._errorPhases.set(error, 'style');
    this._rejectPendingStyle(error);
  };

  private _rejectPendingStyle(error: Error): void {
    this._rejectStyleReady?.(error);
    this._resolveStyleReady = null;
    this._rejectStyleReady = null;
  }

  private _handleMove = (): void => {
    this._syncCamera();
  };

  private _handleResize = (): void => {
    if (!this._map || this._suspended) return;
    this._map.resize();
  };

  private _handleCrsChange = (): void => {
    const suspended = !this._isWebMercator(this._host.getCRS());
    this._suspended = suspended;
    this._syncVisibility();
    if (!suspended && this._map && this._hasActiveService()) {
      this._map.resize();
      this._syncCamera();
    }
  };

  private _syncCamera(): void {
    if (!this._map || this._suspended) return;
    this._map.jumpTo({ center: this._host.getCenter(), zoom: this._host.getZoom() });
  }

  private _syncVisibility(): void {
    if (!this._container) return;
    this._container.hidden = this._suspended || !this._hasActiveService();
  }

  private _hasActiveService(): boolean {
    return [...this._registry.values()].some((record) => record.state.active);
  }

  private _hasActiveOverlay(): boolean {
    return [...this._registry.values()].some(
      (record) => record.definition.role === 'overlay' && record.state.active,
    );
  }

  private _isWebMercator(crs: string): boolean {
    const normalized = crs.toLowerCase();
    return normalized === 'webmercator' || normalized === 'epsg:3857';
  }

  private _setStatus(
    record: ServiceRecord,
    operationRevision: number,
    status: MapLibreServiceState['status'],
  ): void {
    this._assertCurrentOperation(record, operationRevision);
    record.state = { id: record.definition.id, active: record.state.active, status };
    this._emitChange(record.definition, 'status', record.state);
    this._assertCurrentOperation(record, operationRevision);
  }

  private _assertCurrentOperation(record: ServiceRecord, operationRevision: number): void {
    if (!this._isCurrentOperation(record, operationRevision)) {
      throw abortError(`MapLibre service "${record.definition.id}" request was superseded`);
    }
  }

  private _isCurrentOperation(record: ServiceRecord, operationRevision: number): boolean {
    return (
      !this._destroyed &&
      this._registry.get(record.definition.id) === record &&
      record.operationRevision === operationRevision
    );
  }

  private _handleTransitionFailure(
    record: ServiceRecord,
    operationRevision: number,
    value: unknown,
  ): never {
    const error = toError(value);
    if (error.name === 'AbortError' || !this._isCurrentOperation(record, operationRevision)) {
      throw error.name === 'AbortError'
        ? error
        : abortError(`MapLibre service "${record.definition.id}" request was superseded`);
    }
    this._publishTransitionFailure(record, operationRevision, error);
    throw error;
  }

  private _publishTransitionFailure(
    record: ServiceRecord,
    operationRevision: number,
    error: Error,
  ): void {
    this._assertCurrentOperation(record, operationRevision);
    record.state = {
      id: record.definition.id,
      active: record.state.active,
      status: 'error',
      error,
    };
    this._emitChange(record.definition, 'status', record.state);
    this._assertCurrentOperation(record, operationRevision);
    this._emitFatalError(record.definition.id, error);
  }

  private _phaseError(phase: MapLibreServiceErrorEvent['phase'], message: string): Error {
    const error = new Error(message);
    this._errorPhases.set(error, phase);
    return error;
  }

  private _emitFatalError(serviceId: string, error: Error): void {
    const phase = this._errorPhases.get(error) ?? 'lifecycle';
    this.fire('error', {
      serviceId,
      phase,
      error,
      fatal: true,
    });
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
