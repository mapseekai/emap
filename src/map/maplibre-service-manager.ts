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

interface StyleRequest {
  revision: number;
  basemapId: string | null;
  definitionRevision?: number;
  style: string | maplibregl.StyleSpecification;
  phase: 'initial' | 'switch' | 'recovery';
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  settled: boolean;
  requiresProjection: boolean;
  failure?: Error;
  rollback?: {
    definition: MapLibreService;
    definitionRevision: number;
  };
}

interface ReadyStyle {
  generation: number;
  requestRevision: number;
}

interface LastReadyBasemap {
  id: string;
  definitionRevision: number;
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

function isAbortError(value: unknown): boolean {
  return (
    typeof value === 'object' && value !== null && 'name' in value && value.name === 'AbortError'
  );
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
  private _styleRevision = 0;
  private _map: maplibregl.Map | null = null;
  private _mapPromise: Promise<maplibregl.Map> | null = null;
  private _projectionPromise: Promise<void> | null = null;
  private _initializationPromise: Promise<void> | null = null;
  private _container: HTMLElement | null = null;
  private _styleGeneration = 0;
  private _desiredRequest: StyleRequest | null = null;
  private _appliedRequest: StyleRequest | null = null;
  private _parsedRequest: StyleRequest | null = null;
  private _committedRequest: StyleRequest | null = null;
  private _readyStyle: ReadyStyle | null = null;
  private _lastReadyBasemap: LastReadyBasemap | null = null;
  private _destroyed = false;
  private _suspended = false;
  private _mutationContext: MutationContext | null = null;
  private _errorPhases = new WeakMap<Error, MapLibreServiceErrorEvent['phase']>();
  private _errorServiceIds = new WeakMap<Error, string>();
  private _reconciliationJobs = new WeakMap<
    ServiceRecord,
    { revision: number; promise: Promise<void> }
  >();
  private _reconciliationFailures = new WeakMap<
    ServiceRecord,
    { generation: number; error: Error }
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
    const operationRevision = record.operationRevision;
    this._emitChange(record.definition, 'add', record.state);
    this._assertCurrentOperation(record, operationRevision);
    if (record.definition.role === 'overlay' && record.state.active) {
      await this._startOverlayReconciliation(record, operationRevision);
    }
  }

  async updateService(id: string, service: MapLibreService): Promise<void> {
    const record = this._requireService(id);
    if (service.id !== id) throw new Error(`MapLibre service id must match "${id}"`);
    if (service.role !== record.definition.role)
      throw new Error('MapLibre service role cannot change');
    validateService(service, this._registry, id);

    const pendingReconciliation = this._reconciliationJobs.get(record)?.promise;
    const pendingInitialization = this._initializationPromise ?? undefined;
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
    if (replacement.definition.role === 'basemap' && replacement.state.active) {
      await this._requestBasemap(replacement, {
        rollback: {
          definition: previousDefinition,
          definitionRevision: previousDefinitionRevision,
        },
      });
    } else if (replacement.definition.role === 'overlay' && replacement.state.active) {
      await this._updateActiveOverlay(
        replacement,
        previousDefinition as MapLibreOverlayService,
        previousDefinitionRevision,
        replacement.operationRevision,
        pendingReconciliation,
        pendingInitialization,
      );
    }
  }

  async removeService(id: string): Promise<void> {
    const record = this._requireService(id);
    if (
      record.definition.role === 'basemap' &&
      (record.state.active || this._desiredRequest?.basemapId === id)
    ) {
      await this.setBasemap(null);
      if (this._registry.get(id) !== record) {
        throw abortError(`MapLibre service "${id}" request was superseded`);
      }
    }
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
    const desired = this._desiredRequest;
    if (desired?.basemapId === id && !desired.failure) {
      if (!desired.settled) await desired.promise;
      return;
    } else if (!desired && current?.definition.id === next?.definition.id) {
      return;
    }
    await this._requestBasemap(next);
  }

  private _requestBasemap(
    next: ServiceRecord | undefined,
    options: {
      rollback?: { definition: MapLibreService; definitionRevision: number };
      phase?: StyleRequest['phase'];
    } = {},
  ): Promise<void> {
    const previous = this._desiredRequest;
    const current = this._activeBasemap();
    const request = this._createStyleRequest(
      next?.definition.id ?? null,
      next?.definition.role === 'basemap' ? next.definition.style : EMPTY_STYLE,
      options.phase ?? (this._map || this._mapPromise ? 'switch' : 'initial'),
      next?.definitionRevision,
      options.rollback,
      next !== undefined && current !== next,
    );
    this._desiredRequest = request;
    if (previous && previous !== request) {
      this._rejectStyleRequest(previous, abortError('MapLibre basemap request was superseded'));
    }

    if (current && current !== next) this._setActive(current, false);
    if (next) {
      next.operationRevision++;
      next.state = {
        id: next.definition.id,
        active: true,
        status: 'loading',
      };
    }

    if (current && current !== next) {
      this._emitChange(current.definition, 'basemap', current.state);
      if (this._desiredRequest !== request) return request.promise;
    }
    if (next) {
      this._emitChange(next.definition, 'basemap', next.state);
      if (this._desiredRequest !== request) return request.promise;
    }

    if (!next && !this._hasActiveOverlay()) {
      this._readyStyle = null;
      this._committedRequest = null;
      this._lastReadyBasemap = null;
      this._resolveStyleRequest(request);
      this._syncVisibility();
      return request.promise;
    }

    this._prepareStyleRequest(request);
    return request.promise;
  }

  private _createStyleRequest(
    basemapId: string | null,
    style: string | maplibregl.StyleSpecification,
    phase: StyleRequest['phase'],
    definitionRevision?: number,
    rollback?: StyleRequest['rollback'],
    requiresProjection = true,
  ): StyleRequest {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    void promise.catch(() => undefined);
    return {
      revision: ++this._styleRevision,
      basemapId,
      definitionRevision,
      style: typeof style === 'string' ? style : cloneValue(style),
      phase,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      settled: false,
      requiresProjection,
      rollback,
    };
  }

  private _resolveStyleRequest(request: StyleRequest): void {
    if (request.settled) return;
    request.settled = true;
    request.resolve();
  }

  private _rejectStyleRequest(request: StyleRequest, error: Error): void {
    if (request.settled) return;
    request.settled = true;
    request.failure = error;
    request.reject(error);
  }

  private _prepareStyleRequest(request: StyleRequest): void {
    if (
      this._map &&
      (!request.requiresProjection ||
        (this._isWebMercator(this._host.getCRS()) && !this._projectionPromise))
    ) {
      this._startDesiredStyleIfIdle();
      return;
    }
    void (async () => {
      try {
        if (request.requiresProjection) await this._ensureWebMercator();
        if (this._desiredRequest !== request) return;
        await this._ensureMap(request.style);
        if (this._desiredRequest !== request) return;
        this._startDesiredStyleIfIdle();
      } catch (value) {
        const error = toError(value);
        if (this._desiredRequest !== request || isAbortError(error)) return;
        this._handleDesiredSetupFailure(request, error);
      }
    })();
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
  initialize(): Promise<void> {
    if (!this._initializationPromise) {
      const initialRecords = new Map<ServiceRecord, number>();
      for (const record of this._registry.values()) {
        if (record.definition.role === 'overlay' && record.state.active) {
          initialRecords.set(record, record.operationRevision);
        }
      }
      const initialization = Promise.resolve().then(() => this._initialize(initialRecords));
      this._initializationPromise = initialization;
      void initialization.catch(() => {
        if (this._initializationPromise === initialization) this._initializationPromise = null;
      });
    }
    return this._initializationPromise;
  }

  private async _initialize(initialRecords: ReadonlyMap<ServiceRecord, number>): Promise<void> {
    const defaultBasemap =
      this._options.defaultBasemap === undefined
        ? undefined
        : this._requireBasemap(this._options.defaultBasemap);
    if (initialRecords.size === 0 && !defaultBasemap) return;
    if (this._desiredRequest?.settled && this._desiredRequest.failure && !this._map) {
      this._desiredRequest = null;
    }
    try {
      if (defaultBasemap) {
        await this._requestBasemap(defaultBasemap, { phase: 'initial' });
      } else {
        await this._ensureWebMercator();
        await this._ensureStableStyleForRuntime();
      }
    } catch (value) {
      const error = toError(value);
      let failure = error;
      for (const [record, operationRevision] of initialRecords) {
        if (
          !this._isCurrentOperation(record, operationRevision) ||
          record.definition.role !== 'overlay' ||
          !record.state.active
        ) {
          continue;
        }
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
          failure = publishError;
          break;
        }
      }
      if (this._errorPhases.get(error) === 'style' && !this._map) {
        try {
          this._resetRuntime();
        } catch {
          // Preserve the style failure while leaving runtime fields reset for a retry.
        }
      }
      throw failure;
    }
    const generation = this._readyStyle?.generation;
    if (generation === undefined) throw new Error('MapLibre style readiness is unavailable');
    await this._reconcileVisibleOverlays(generation, true, initialRecords);
    this._syncVisibility();
  }

  /** @internal */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    for (const record of this._registry.values()) record.operationRevision++;
    const destroyedError = abortError('MapLibre service manager was destroyed');
    if (this._desiredRequest) this._rejectStyleRequest(this._desiredRequest, destroyedError);
    if (this._appliedRequest) this._rejectStyleRequest(this._appliedRequest, destroyedError);

    let firstError: Error | undefined;
    const attempt = (action: () => void): void => {
      try {
        action();
      } catch (value) {
        firstError ??= toError(value);
      }
    };
    attempt(() => this._host.off('move', this._handleMove));
    attempt(() => this._host.off('resize', this._handleResize));
    attempt(() => this._host.off('crschange', this._handleCrsChange));
    if (this._map) {
      attempt(() => this._map?.off('style.load', this._handleStyleLoad));
      attempt(() => this._map?.off('error', this._handleMapError));
      attempt(() => this._map?.remove());
    }
    attempt(() => this._container?.remove());
    this._container = null;
    this._map = null;
    this._mapPromise = null;
    this._desiredRequest = null;
    this._appliedRequest = null;
    this._parsedRequest = null;
    this._committedRequest = null;
    this._readyStyle = null;
    if (firstError) throw firstError;
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
    if (this._desiredRequest?.settled && this._desiredRequest.failure && !this._map) {
      this._desiredRequest = null;
    }
    job.promise = (async () => {
      try {
        this._setStatus(record, operationRevision, 'loading');
        if (ensureProjection) {
          await this._ensureWebMercator();
          this._assertCurrentOperation(record, operationRevision);
        }
        for (;;) {
          await this._ensureStableStyleForRuntime();
          this._assertCurrentOperation(record, operationRevision);
          const generation = this._readyStyle?.generation;
          if (generation === undefined) continue;
          try {
            const failure = this._reconciliationFailures.get(record);
            if (failure?.generation === generation) {
              this._reconciliationFailures.delete(record);
              throw failure.error;
            }
            if (this._isOverlayInstalled(record, generation)) break;
            await this._reconcileOverlayForGeneration(record, operationRevision, generation);
            this._assertCurrentOperation(record, operationRevision);
            break;
          } catch (value) {
            const error = toError(value);
            if (
              error.name === 'AbortError' &&
              this._isCurrentOperation(record, operationRevision)
            ) {
              continue;
            }
            throw error;
          }
        }
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
    pendingReconciliation?: Promise<void>,
    pendingInitialization?: Promise<void>,
  ): Promise<void> {
    try {
      this._setStatus(record, operationRevision, 'loading');
      if (pendingReconciliation) {
        try {
          await pendingReconciliation;
        } catch (value) {
          if (!isAbortError(value)) throw value;
        }
        this._assertCurrentOperation(record, operationRevision);
      } else if (pendingInitialization) {
        try {
          await pendingInitialization;
        } catch {
          // The current update takes over setup after a failed initial attempt.
        }
        this._assertCurrentOperation(record, operationRevision);
      }
      if (!this._map && !this._mapPromise) {
        await this._ensureWebMercator();
        this._assertCurrentOperation(record, operationRevision);
      }
      for (;;) {
        await this._ensureStableStyleForRuntime();
        this._assertCurrentOperation(record, operationRevision);
        const generation = this._readyStyle?.generation;
        if (generation === undefined) continue;
        try {
          if (this._isOverlayInstalled(record, generation)) break;
          await this._removeOverlayResources(record, operationRevision, previousDefinition);
          this._assertCurrentOperation(record, operationRevision);
          await this._reconcileOverlayForGeneration(record, operationRevision, generation);
          break;
        } catch (value) {
          const error = toError(value);
          if (error.name === 'AbortError' && this._isCurrentOperation(record, operationRevision)) {
            continue;
          }
          throw error;
        }
      }
      this._setStatus(record, operationRevision, 'ready');
    } catch (error) {
      const originalError = toError(error);
      if (
        originalError.name !== 'AbortError' &&
        this._isCurrentOperation(record, operationRevision)
      ) {
        this._emitFatalError(record.definition.id, originalError);
        this._assertCurrentOperation(record, operationRevision);
        record.state = {
          id: record.definition.id,
          active: true,
          status: 'error',
          error: originalError,
        };
        this._emitChange(record.definition, 'status', record.state);
        this._assertCurrentOperation(record, operationRevision);
        record.definition = cloneService(previousDefinition);
        record.definitionRevision = previousDefinitionRevision;
        this._emitChange(record.definition, 'update', record.state);
        this._assertCurrentOperation(record, operationRevision);
        try {
          this._setStatus(record, operationRevision, 'loading');
          for (;;) {
            await this._ensureStableStyleForRuntime();
            this._assertCurrentOperation(record, operationRevision);
            const generation = this._readyStyle?.generation;
            if (generation === undefined) continue;
            try {
              await this._removeOverlayResources(record, operationRevision);
              await this._reconcileOverlayForGeneration(record, operationRevision, generation);
              break;
            } catch (value) {
              const rollbackError = toError(value);
              if (
                rollbackError.name === 'AbortError' &&
                this._isCurrentOperation(record, operationRevision)
              ) {
                continue;
              }
              throw rollbackError;
            }
          }
        } catch (rollbackValue) {
          const rollbackError = toError(rollbackValue);
          if (!this._isCurrentOperation(record, operationRevision)) {
            throw abortError(`MapLibre service "${record.definition.id}" request was superseded`);
          }
          record.state = {
            id: record.definition.id,
            active: true,
            status: 'error',
            error: rollbackError,
          };
          this._emitChange(record.definition, 'status', record.state);
          this._assertCurrentOperation(record, operationRevision);
          this._emitFatalError(record.definition.id, rollbackError);
          throw originalError;
        }
        this._setStatus(record, operationRevision, 'ready');
        throw originalError;
      }
      this._handleTransitionFailure(record, operationRevision, originalError);
    }
  }

  private async _reconcileVisibleOverlays(
    generation: number,
    publishStatus = false,
    candidates?: ReadonlyMap<ServiceRecord, number>,
  ): Promise<void> {
    const records =
      candidates ??
      new Map(
        [...this._registry.values()].map((record) => [record, record.operationRevision] as const),
      );
    let firstError: Error | undefined;
    for (const [record, operationRevision] of records) {
      if (!this._isCurrentOperation(record, operationRevision)) continue;
      if (record.definition.role !== 'overlay' || !record.state.active) continue;
      try {
        if (publishStatus) {
          await this._startOverlayReconciliation(record, operationRevision, false);
          continue;
        }
        await this._reconcileOverlayForGeneration(record, operationRevision, generation);
        this._assertCurrentOperation(record, operationRevision);
      } catch (value) {
        const error = toError(value);
        if (
          error.name === 'AbortError' &&
          (!this._isCurrentOperation(record, operationRevision) || !record.state.active)
        ) {
          continue;
        }
        try {
          this._handleTransitionFailure(record, operationRevision, error);
        } catch (failureValue) {
          const failure = toError(failureValue);
          if (
            failure.name === 'AbortError' &&
            (!this._isCurrentOperation(record, operationRevision) || !record.state.active)
          ) {
            continue;
          }
          firstError ??= failure;
        }
      }
    }
    if (firstError) throw firstError;
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
    this._assertStyleGeneration(generation);
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
        this._assertStyleGeneration(generation);
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
        this._assertStyleGeneration(generation);
        const handle = map.getSource(sourceId);
        if (handle === undefined)
          throw new Error(`MapLibre overlay source "${sourceId}" was not added`);
        record.ownedSources.set(sourceId, { generation, handle });
        addedSourceIds.push(sourceId);
      }

      for (const layer of definition.layers) {
        this._assertCurrentOperation(record, operationRevision);
        this._assertStyleGeneration(generation);
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
        this._assertStyleGeneration(generation);
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

  private _isOverlayInstalled(record: ServiceRecord, generation: number): boolean {
    const map = this._map;
    if (!map || record.definition.role !== 'overlay' || !record.installedDefinition) return false;
    const sourceIds = Object.keys(record.definition.sources);
    const layerIds = record.definition.layers.map((layer) => layer.id);
    if (JSON.stringify(record.installedDefinition) !== JSON.stringify(record.definition))
      return false;
    return (
      sourceIds.every((id) => {
        const owned = record.ownedSources.get(id);
        return owned?.generation === generation && owned.handle === map.getSource(id);
      }) &&
      layerIds.every((id) => {
        const owned = record.ownedLayers.get(id);
        return owned?.generation === generation && owned.handle === map.getLayer(id);
      })
    );
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
      this._errorServiceIds.set(error, serviceId);
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

  private _ensureWebMercator(): Promise<void> {
    if (this._destroyed) {
      return Promise.reject(abortError('MapLibre service manager was destroyed'));
    }
    if (this._projectionPromise) return this._projectionPromise;
    const projection = (async () => {
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
    })();
    this._projectionPromise = projection;
    const clearProjection = (): void => {
      if (this._projectionPromise === projection) this._projectionPromise = null;
    };
    void projection.then(clearProjection, clearProjection);
    return projection;
  }

  private _resetRuntime(): void {
    const map = this._map;
    const container = this._container;
    let firstError: Error | undefined;
    const attempt = (action: () => void): void => {
      try {
        action();
      } catch (value) {
        firstError ??= toError(value);
      }
    };
    attempt(() => this._host.off('move', this._handleMove));
    attempt(() => this._host.off('resize', this._handleResize));
    attempt(() => this._host.off('crschange', this._handleCrsChange));
    if (map) {
      attempt(() => map.off('style.load', this._handleStyleLoad));
      attempt(() => map.off('error', this._handleMapError));
      attempt(() => map.remove());
    }
    attempt(() => container?.remove());
    this._container = null;
    this._map = null;
    this._mapPromise = null;
    this._appliedRequest = null;
    this._parsedRequest = null;
    this._committedRequest = null;
    this._readyStyle = null;
    for (const record of this._registry.values()) {
      record.ownedLayers.clear();
      record.ownedSources.clear();
      record.installedDefinition = undefined;
    }
    if (firstError) throw firstError;
  }

  private async _ensureMap(
    initialStyle: string | maplibregl.StyleSpecification,
  ): Promise<maplibregl.Map> {
    if (this._map) return this._map;
    if (this._mapPromise) return this._mapPromise;
    this._mapPromise = (async () => {
      const maplibre = await this._loadMapLibre();
      if (this._destroyed) throw abortError('MapLibre service manager was destroyed');
      if (!this._hasActiveService()) {
        throw abortError('MapLibre runtime request was superseded');
      }
      const request = this._desiredRequest;
      if (!request || request.settled) {
        throw abortError('MapLibre style request was superseded');
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
        this._styleGeneration++;
        this._readyStyle = null;
        this._parsedRequest = null;
        this._appliedRequest = request;
        map = new maplibre.Map({
          ...MAP_DEFAULTS,
          ...this._options.mapOptions,
          container,
          style: request.style ?? initialStyle,
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
        if (this._appliedRequest === request) this._appliedRequest = null;
        this._readyStyle = null;
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

  private async _ensureStableStyleForRuntime(): Promise<void> {
    for (;;) {
      if (this._destroyed) throw abortError('MapLibre service manager was destroyed');
      const desired = this._desiredRequest;
      if (desired && this._readyStyle?.requestRevision === desired.revision && desired.settled) {
        return;
      }

      if (desired?.settled && desired.failure) throw desired.failure;

      let request = desired;
      if (!request || request.settled) {
        const activeBasemap = this._activeBasemap();
        request = this._createStyleRequest(
          activeBasemap?.definition.id ?? null,
          activeBasemap?.definition.role === 'basemap'
            ? activeBasemap.definition.style
            : EMPTY_STYLE,
          this._map || this._mapPromise ? 'switch' : 'initial',
          activeBasemap?.definitionRevision,
        );
        this._desiredRequest = request;
        this._prepareStyleRequest(request);
      } else if (!this._map && !this._mapPromise) {
        this._prepareStyleRequest(request);
      } else {
        this._startDesiredStyleIfIdle();
      }

      try {
        await request.promise;
      } catch (value) {
        if (this._desiredRequest !== request) continue;
        throw value;
      }
      if (this._readyStyle?.requestRevision === request.revision) return;
    }
  }

  private _startDesiredStyleIfIdle(): void {
    const request = this._desiredRequest;
    const map = this._map;
    if (
      !request ||
      request.settled ||
      !map ||
      this._appliedRequest ||
      this._parsedRequest ||
      this._readyStyle?.requestRevision === request.revision
    ) {
      return;
    }
    if (request.basemapId === null && request.phase !== 'recovery' && !this._hasActiveOverlay()) {
      this._readyStyle = null;
      this._lastReadyBasemap = null;
      this._resolveStyleRequest(request);
      this._syncVisibility();
      return;
    }

    try {
      this._detachManagedOverlays();
    } catch (value) {
      this._handleStyleDetachmentFailure(request, toError(value));
      return;
    }
    if (this._desiredRequest !== request) return;

    try {
      this._styleGeneration++;
      this._readyStyle = null;
      this._appliedRequest = request;
      map.setStyle(request.style, { diff: false });
      this._committedRequest = null;
    } catch (value) {
      const error = toError(value);
      this._errorPhases.set(error, 'style');
      if (this._appliedRequest === request) this._appliedRequest = null;
      this._detachFailedStyle();
      this._handleAppliedStyleFailure(request, error);
    }
  }

  private _handleStyleDetachmentFailure(request: StyleRequest, error: Error): void {
    this._rejectStyleRequest(request, error);
    if (this._desiredRequest !== request) return;

    const committed =
      this._committedRequest &&
      this._readyStyle?.requestRevision === this._committedRequest.revision
        ? this._committedRequest
        : null;
    this._desiredRequest = committed;
    const isCurrent = (
      record: ServiceRecord,
      definitionRevision: number,
      operationRevision: number,
    ): boolean =>
      this._desiredRequest === committed &&
      this._registry.get(record.definition.id) === record &&
      record.definitionRevision === definitionRevision &&
      record.operationRevision === operationRevision;
    const requireCurrent = (
      record: ServiceRecord,
      definitionRevision: number,
      operationRevision: number,
    ): boolean => {
      if (isCurrent(record, definitionRevision, operationRevision)) return true;
      if (this._desiredRequest === committed) {
        this._desiredRequest = null;
        this._committedRequest = null;
        this._readyStyle = null;
        this._lastReadyBasemap = null;
        this._syncVisibility();
      }
      return false;
    };

    let rollbackEvent:
      | { record: ServiceRecord; definitionRevision: number; operationRevision: number }
      | undefined;
    if (request.rollback && request.basemapId !== null) {
      const rollback = this._registry.get(request.basemapId);
      if (rollback?.definition.role === 'basemap') {
        rollback.definition = cloneService(request.rollback.definition);
        rollback.definitionRevision = request.rollback.definitionRevision;
        rollbackEvent = {
          record: rollback,
          definitionRevision: rollback.definitionRevision,
          operationRevision: rollback.operationRevision,
        };
      }
    }

    let failedEvent:
      | { record: ServiceRecord; definitionRevision: number; operationRevision: number }
      | undefined;
    if (request.basemapId !== null && request.basemapId !== committed?.basemapId) {
      const failed = this._registry.get(request.basemapId);
      if (
        failed?.definition.role === 'basemap' &&
        failed.definitionRevision === request.definitionRevision
      ) {
        failed.operationRevision++;
        failed.state = {
          id: failed.definition.id,
          active: false,
          status: 'error',
          error,
        };
        failedEvent = {
          record: failed,
          definitionRevision: failed.definitionRevision,
          operationRevision: failed.operationRevision,
        };
      }
    }

    const ownerId = this._errorServiceIds.get(error);
    const owner = ownerId ? this._registry.get(ownerId) : undefined;
    if (owner?.definition.role === 'overlay') {
      const ownerDefinitionRevision = owner.definitionRevision;
      const ownerOperationRevision = owner.operationRevision;
      owner.state = {
        id: owner.definition.id,
        active: owner.state.active,
        status: 'error',
        error,
      };
      if (!requireCurrent(owner, ownerDefinitionRevision, ownerOperationRevision)) return;
      this._emitChange(owner.definition, 'status', owner.state);
      if (!requireCurrent(owner, ownerDefinitionRevision, ownerOperationRevision)) return;
      this._emitFatalError(owner.definition.id, error);
      if (!requireCurrent(owner, ownerDefinitionRevision, ownerOperationRevision)) return;
    } else {
      this.fire('error', {
        serviceId: ownerId,
        phase: this._errorPhases.get(error) ?? 'lifecycle',
        error,
        fatal: true,
      });
      if (this._desiredRequest !== committed) return;
    }

    if (rollbackEvent) {
      const { record, definitionRevision, operationRevision } = rollbackEvent;
      if (!requireCurrent(record, definitionRevision, operationRevision)) return;
      this._emitChange(record.definition, 'update', record.state);
      if (!requireCurrent(record, definitionRevision, operationRevision)) return;
    }

    if (failedEvent) {
      const { record, definitionRevision, operationRevision } = failedEvent;
      if (!requireCurrent(record, definitionRevision, operationRevision)) return;
      this._emitChange(record.definition, 'status', record.state);
      if (!requireCurrent(record, definitionRevision, operationRevision)) return;
      this._emitChange(record.definition, 'basemap', record.state);
      if (!requireCurrent(record, definitionRevision, operationRevision)) return;
    }

    if (committed?.basemapId !== null && committed?.basemapId !== undefined) {
      const previous = this._registry.get(committed.basemapId);
      if (
        previous?.definition.role === 'basemap' &&
        previous.definitionRevision === committed.definitionRevision
      ) {
        previous.operationRevision++;
        const previousOperationRevision = previous.operationRevision;
        previous.state = { id: previous.definition.id, active: true, status: 'ready' };
        if (!requireCurrent(previous, committed.definitionRevision, previousOperationRevision)) {
          return;
        }
        this._emitChange(previous.definition, 'basemap', previous.state);
        if (!requireCurrent(previous, committed.definitionRevision, previousOperationRevision)) {
          return;
        }
        this._emitChange(previous.definition, 'status', previous.state);
        if (!requireCurrent(previous, committed.definitionRevision, previousOperationRevision)) {
          return;
        }
      }
    }

    const generation = this._readyStyle?.generation;
    if (generation !== undefined) {
      void this._reconcileVisibleOverlays(generation).catch(() => undefined);
    }
    this._syncVisibility();
  }

  private _detachManagedOverlays(): void {
    const map = this._map;
    if (!map) return;
    const records = [...this._registry.values()].filter(
      (record) => record.definition.role === 'overlay',
    );
    const layers: Array<{ record: ServiceRecord; id: string }> = [];
    for (const record of records) {
      const orderedIds = record.installedDefinition?.layers.map((layer) => layer.id) ?? [];
      for (const id of orderedIds) {
        if (record.ownedLayers.has(id)) layers.push({ record, id });
      }
      for (const id of record.ownedLayers.keys()) {
        if (!orderedIds.includes(id)) layers.push({ record, id });
      }
    }
    for (const { record, id } of layers.reverse()) {
      const owned = record.ownedLayers.get(id);
      if (!owned) continue;
      const current = map.getLayer(id);
      if (current !== undefined && current !== owned.handle) {
        throw this._phaseError(
          'layer',
          `MapLibre overlay layer "${id}" is no longer manager-owned`,
          record.definition.id,
        );
      }
      if (current !== undefined) {
        this._mutateResource(
          record.definition.id,
          'layer',
          id,
          () => map.removeLayer(id),
          () => map.getLayer(id) === undefined,
        );
      }
      record.ownedLayers.delete(id);
    }

    for (const record of records) {
      for (const [id, owned] of record.ownedSources) {
        const current = map.getSource(id);
        if (current !== undefined && current !== owned.handle) {
          throw this._phaseError(
            'source',
            `MapLibre overlay source "${id}" is no longer manager-owned`,
            record.definition.id,
          );
        }
        if (current !== undefined) {
          this._mutateResource(
            record.definition.id,
            'source',
            id,
            () => map.removeSource(id),
            () => map.getSource(id) === undefined,
          );
        }
        record.ownedSources.delete(id);
      }
      record.installedDefinition = undefined;
    }
  }

  private async _finishParsedStyle(request: StyleRequest, generation: number): Promise<void> {
    for (const record of this._registry.values()) {
      if (this._desiredRequest !== request) break;
      if (record.definition.role !== 'overlay' || !record.state.active) continue;
      try {
        await this._reconcileOverlayForGeneration(record, record.operationRevision, generation);
        this._reconciliationFailures.delete(record);
      } catch (value) {
        const error = toError(value);
        if (error.name === 'AbortError') break;
        this._reconciliationFailures.set(record, { generation, error });
        if (record.state.status !== 'idle' && !this._reconciliationJobs.has(record)) {
          try {
            this._publishTransitionFailure(record, record.operationRevision, error);
          } catch {
            // Reentrant listeners may supersede the failed overlay.
          }
        }
      }
    }

    if (this._parsedRequest !== request) return;
    if (this._desiredRequest !== request) {
      this._parsedRequest = null;
      this._startDesiredStyleIfIdle();
      return;
    }

    if (request.basemapId !== null) {
      const record = this._registry.get(request.basemapId);
      if (
        !record ||
        record.definition.role !== 'basemap' ||
        record.definitionRevision !== request.definitionRevision ||
        !record.state.active
      ) {
        this._parsedRequest = null;
        this._rejectStyleRequest(request, abortError('MapLibre basemap request was superseded'));
        this._startDesiredStyleIfIdle();
        return;
      }
      const operationRevision = record.operationRevision;
      record.state = { id: record.definition.id, active: true, status: 'ready' };
      this._emitChange(record.definition, 'status', record.state);
      if (
        this._desiredRequest !== request ||
        !this._isCurrentOperation(record, operationRevision)
      ) {
        this._parsedRequest = null;
        this._startDesiredStyleIfIdle();
        return;
      }
      this._lastReadyBasemap = {
        id: record.definition.id,
        definitionRevision: record.definitionRevision,
      };
    } else {
      this._lastReadyBasemap = null;
    }

    this._readyStyle = { generation, requestRevision: request.revision };
    this._committedRequest = request;
    this._parsedRequest = null;
    this._resolveStyleRequest(request);
    this._syncVisibility();
  }

  private _handleDesiredSetupFailure(request: StyleRequest, error: Error): void {
    this._rejectStyleRequest(request, error);
    if (request.basemapId === null) return;
    if (!this._publishBasemapFailure(request, error)) return;
    if (this._map) this._enqueueRecovery(request);
  }

  private _handleAppliedStyleFailure(request: StyleRequest, error: Error): void {
    if (this._desiredRequest !== request) {
      this._startDesiredStyleIfIdle();
      return;
    }
    this._rejectStyleRequest(request, error);
    if (request.phase === 'initial' && request.basemapId === null) {
      for (const record of this._registry.values()) {
        if (record.definition.role !== 'overlay' || !record.state.active) continue;
        try {
          this._publishTransitionFailure(record, record.operationRevision, error);
        } catch {
          // Reentrant listeners may hide or remove a later initial overlay.
        }
      }
      try {
        this._resetRuntime();
      } catch {
        // Preserve the original style failure for every public overlay waiter.
      }
      return;
    }
    if (request.basemapId !== null) {
      if (!this._publishBasemapFailure(request, error)) return;
      if (request.rollback) {
        const record = this._registry.get(request.basemapId);
        if (record?.definition.role === 'basemap') {
          record.definition = cloneService(request.rollback.definition);
          record.definitionRevision = request.rollback.definitionRevision;
          this._emitChange(record.definition, 'update', record.state);
          if (this._desiredRequest !== request) return;
        }
      }
    } else {
      this.fire('error', { phase: 'style', error, fatal: true });
      if (this._desiredRequest !== request) return;
    }
    this._enqueueRecovery(request);
  }

  private _publishBasemapFailure(request: StyleRequest, error: Error): boolean {
    if (this._desiredRequest !== request || request.basemapId === null) return false;
    const record = this._registry.get(request.basemapId);
    if (
      !record ||
      record.definition.role !== 'basemap' ||
      record.definitionRevision !== request.definitionRevision
    ) {
      return false;
    }
    record.operationRevision++;
    record.state = {
      id: record.definition.id,
      active: false,
      status: 'error',
      error,
    };
    const operationRevision = record.operationRevision;
    const isCurrentFailure = (): boolean =>
      this._desiredRequest === request &&
      this._registry.get(record.definition.id) === record &&
      record.operationRevision === operationRevision &&
      record.definitionRevision === request.definitionRevision;
    this._emitFatalError(record.definition.id, error);
    if (!isCurrentFailure()) return false;
    this._emitChange(record.definition, 'status', record.state);
    if (!isCurrentFailure()) return false;
    this._emitChange(record.definition, 'basemap', record.state);
    return isCurrentFailure();
  }

  private _enqueueRecovery(failedRequest: StyleRequest): void {
    if (this._desiredRequest !== failedRequest) return;
    if (failedRequest.phase === 'recovery' && failedRequest.basemapId === null) return;
    const lastReady = this._lastReadyBasemap;
    const candidate = lastReady ? this._registry.get(lastReady.id) : undefined;
    const validCandidate =
      failedRequest.phase !== 'recovery' &&
      candidate?.definition.role === 'basemap' &&
      candidate.definitionRevision === lastReady?.definitionRevision
        ? candidate
        : undefined;
    const request = this._createStyleRequest(
      validCandidate?.definition.id ?? null,
      validCandidate?.definition.role === 'basemap' ? validCandidate.definition.style : EMPTY_STYLE,
      'recovery',
      validCandidate?.definitionRevision,
      undefined,
      false,
    );
    this._desiredRequest = request;
    if (validCandidate) {
      validCandidate.operationRevision++;
      validCandidate.state = {
        id: validCandidate.definition.id,
        active: true,
        status: 'loading',
      };
      this._emitChange(validCandidate.definition, 'basemap', validCandidate.state);
      if (this._desiredRequest !== request) return;
      this._emitChange(validCandidate.definition, 'status', validCandidate.state);
      if (this._desiredRequest !== request) return;
    }
    this._prepareStyleRequest(request);
  }

  private _detachFailedStyle(): void {
    try {
      this._map?.setStyle(null);
    } catch {
      // The original style failure remains the public failure.
    }
    this._readyStyle = null;
    this._parsedRequest = null;
    this._committedRequest = null;
    for (const record of this._registry.values()) {
      record.ownedLayers.clear();
      record.ownedSources.clear();
      record.installedDefinition = undefined;
    }
  }

  private _findOwnedSource(sourceId: string): ServiceRecord | undefined {
    const current = this._map?.getSource(sourceId);
    if (current === undefined) return undefined;
    for (const record of this._registry.values()) {
      const owned = record.ownedSources.get(sourceId);
      if (owned?.generation === this._styleGeneration && owned.handle === current) return record;
    }
    return undefined;
  }

  private _handleStyleLoad = (): void => {
    if (this._destroyed || !this._appliedRequest) return;
    const request = this._appliedRequest;
    this._appliedRequest = null;
    if (this._desiredRequest !== request) {
      this._startDesiredStyleIfIdle();
      return;
    }
    this._parsedRequest = request;
    void this._finishParsedStyle(request, this._styleGeneration);
  };

  private _handleMapError = (event?: unknown): void => {
    const details = event as { error?: unknown; sourceId?: string; tile?: unknown } | undefined;
    const error = toError(details?.error ?? event);
    if (this._mutationContext) {
      this._mutationContext.error = error;
      this._errorPhases.set(error, this._mutationContext.phase);
      this._errorServiceIds.set(error, this._mutationContext.serviceId);
      return;
    }
    if (details?.tile !== undefined) {
      this.fire('error', { phase: 'tile', fatal: false, error });
      return;
    }
    if (details?.sourceId) {
      const owner = this._findOwnedSource(details.sourceId);
      if (owner) {
        this._errorPhases.set(error, 'source');
        try {
          this._publishTransitionFailure(owner, owner.operationRevision, error);
        } catch {
          // Reentrant listeners may supersede the failing overlay.
        }
        return;
      }
    }
    if (this._appliedRequest) {
      const request = this._appliedRequest;
      this._appliedRequest = null;
      this._errorPhases.set(error, 'style');
      this._detachFailedStyle();
      this._handleAppliedStyleFailure(request, error);
      return;
    }
    this.fire('error', { phase: 'lifecycle', fatal: false, error });
  };

  private _handleMove = (): void => {
    this._syncCamera();
  };

  private _handleResize = (): void => {
    if (!this._map || this._suspended) return;
    this._map.resize();
    this._syncCamera();
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

  private _assertStyleGeneration(generation: number): void {
    const desiredRevision = this._desiredRequest?.revision;
    const ready =
      this._readyStyle?.generation === generation &&
      this._readyStyle.requestRevision === desiredRevision;
    const parsed =
      this._styleGeneration === generation && this._parsedRequest?.revision === desiredRevision;
    if (!ready && !parsed) throw abortError('MapLibre style generation was superseded');
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
    if (record.state.status === 'error' && record.state.error === error) return;
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

  private _phaseError(
    phase: MapLibreServiceErrorEvent['phase'],
    message: string,
    serviceId?: string,
  ): Error {
    const error = new Error(message);
    this._errorPhases.set(error, phase);
    if (serviceId !== undefined) this._errorServiceIds.set(error, serviceId);
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
