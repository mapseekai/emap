import type { EmapEventMap } from '../../core/event-map';
import { EventDispatcher, type EventListener } from '../../core/events';
import {
  FeatureEventDispatcher,
  type FeatureEvent,
  type FeatureEventFilter,
} from '../../core/feature-event-dispatcher';
import { PointerEventDispatcher, type PointerMoveEvent } from '../../core/pointer-event-dispatcher';
import type { InteractionContract as InteractionServiceImpl } from '../../../runtime/services/contracts/interaction';
import type { QueryContract as QueryServiceImpl } from '../../../runtime/services/contracts/query';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface Dependencies {
  events: EventDispatcher;
  interaction: Pick<InteractionServiceImpl, '_handlers'>;
  query: Pick<QueryServiceImpl, 'features' | 'queryFeatures'>;
  view: Pick<ViewServiceImpl, 'unproject'>;
}

/** routing implementation, wired through explicit service dependencies. */
export class EventRoutingService {
  _featureEvents!: FeatureEventDispatcher;

  _pointerEvents!: PointerEventDispatcher;

  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  on(type: string, listener: (e: FeatureEvent) => void): this;

  on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;

  on(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.on(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: FeatureEvent) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      this._featureEvents.on(type, filter, cb);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    this.deps.events.on(type, filterOrListener as EventListener);
    return this;
  }

  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  off(type: string, listener: (e: FeatureEvent) => void): this;

  off(type: string, listener: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.off(type, listener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      this._featureEvents.off(type, listener as (e: FeatureEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    this.deps.events.off(type, listener as EventListener);
    return this;
  }

  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;

  once<K extends keyof EmapEventMap>(
    type: K,
    listener: (e: { type: K } & EmapEventMap[K]) => void,
  ): this;

  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;

  once(type: string, listener: (e: FeatureEvent) => void): this;

  once(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;

  once(type: string, filterOrListener: unknown, listener?: unknown): this {
    if (type === 'mousemove') {
      this._pointerEvents.once(type, filterOrListener as (e: PointerMoveEvent) => void);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    if (type.startsWith('feature:')) {
      const cb = (listener ?? filterOrListener) as (e: FeatureEvent) => void;
      const filter = (listener ? filterOrListener : undefined) as FeatureEventFilter | undefined;
      this._featureEvents.once(type, filter, cb);
      // onChange callback drives _syncPointerSink(); no explicit call needed here.
      return this;
    }
    this.deps.events.once(type, filterOrListener as EventListener);
    return this;
  }

  _syncPointerSink(): void {
    if (this._featureEvents.hasListeners() || this._pointerEvents.hasListeners()) {
      this.deps.interaction._handlers.setPointerSink((ev) => {
        this._featureEvents.dispatch(ev);
        this._pointerEvents.dispatch(ev);
      });
    } else {
      this.deps.interaction._handlers.setPointerSink(null);
    }
  }

  dispose(): void {
    this.deps.interaction._handlers.setPointerSink(null);
    this._featureEvents.setOnChange(() => {});
    this._pointerEvents.setOnChange(() => {});
  }

  constructor(private readonly deps: Dependencies) {
    this._featureEvents = new FeatureEventDispatcher({
      queryFeatures: (geometry, options) => this.deps.query.queryFeatures(geometry, options),
      unproject: (x, y) => this.deps.view.unproject(x, y),
      get features() {
        return deps.query.features;
      },
    });
    this._pointerEvents = new PointerEventDispatcher({
      unproject: (x, y) => this.deps.view.unproject(x, y),
    });
    this._featureEvents.setOnChange(() => this._syncPointerSink());
    this._pointerEvents.setOnChange(() => this._syncPointerSink());
  }
}
