import type { EmapEventMap } from '../../core/event-map';
import type { EventListener } from '../../core/events';
import type {
  FeatureEventDispatcher,
  FeatureEvent,
  FeatureEventFilter,
} from '../../core/feature-event-dispatcher';
import type { PointerEventDispatcher, PointerMoveEvent } from '../../core/pointer-event-dispatcher';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface RoutingContract {
  /** @internal */
  _featureEvents: FeatureEventDispatcher;
  /** @internal */
  _pointerEvents: PointerEventDispatcher;
  on(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  on<K extends keyof EmapEventMap>(
    type: K,
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
  ): this;
  on<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  on(type: string, listener: (e: FeatureEvent) => void): this;
  on(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
  off(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  off<K extends keyof EmapEventMap>(
    type: K,
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
  ): this;
  off<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  off(type: string, listener: (e: FeatureEvent) => void): this;
  once(type: 'mousemove', listener: (e: PointerMoveEvent) => void): this;
  once<K extends keyof EmapEventMap>(
    type: K,
    listener: (
      e: {
        type: K;
      } & EmapEventMap[K],
    ) => void,
  ): this;
  once<T = Record<string, unknown>>(type: string, listener: EventListener<T>): this;
  once(type: string, listener: (e: FeatureEvent) => void): this;
  once(type: string, filter: FeatureEventFilter, listener: (e: FeatureEvent) => void): this;
  /** @internal */
  _syncPointerSink(): void;
  dispose(): void;
}
