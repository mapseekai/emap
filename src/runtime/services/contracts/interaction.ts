import type { Handler } from '../../../engine/core/handler';
import type { HandlerManager } from '../../../engine/core/handler-manager';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface InteractionContract {
  /** @internal */
  _handlers: HandlerManager;
  initialize(): void;
  get(name: string): Handler | undefined;
  require<T extends Handler = Handler>(name: string): T;
  register(
    handler: Handler,
    options?: import('../../../engine/core/handler-manager').HandlerRegistration & {
      mode?: string;
      roles?: readonly string[];
      blocks?: readonly string[];
    },
  ): () => void;
  syncMode(mode: string): void;
  dispose(): void;
}
