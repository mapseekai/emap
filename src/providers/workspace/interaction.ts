import type { Handler } from '../../core/handler';
import { HandlerManager } from '../../core/handler-manager';
import type { SurfaceContract as SurfaceServiceImpl } from '../../services/contracts/surface';

interface Dependencies {
  surface: Pick<SurfaceServiceImpl, 'getCanvasContainer'>;
}

/** interaction implementation, wired through explicit service dependencies. */
export class InteractionServiceImpl {
  _handlers!: HandlerManager;

  private registrations = new Map<
    string,
    {
      handler: Handler;
      options: import('../../core/handler-manager').HandlerRegistration & {
        mode?: string;
        roles?: readonly string[];
        blocks?: readonly string[];
      };
      release: () => void;
    }
  >();
  private suspended = new Set<Handler>();
  private mode = 'none';
  initialize(): void {
    this._handlers.attach(this.deps.surface.getCanvasContainer());
  }
  get(name: string): Handler | undefined {
    return this._handlers.get(name);
  }
  require<T extends Handler = Handler>(name: string): T {
    const handler = this.get(name);
    if (!handler) throw new Error(`Interaction plugin is not loaded: ${name}`);
    return handler as T;
  }
  register(
    handler: Handler,
    options: import('../../core/handler-manager').HandlerRegistration & {
      mode?: string;
      roles?: readonly string[];
      blocks?: readonly string[];
    } = {},
  ): () => void {
    const release = this._handlers.register(handler, options);
    const record = { handler, options, release };
    this.registrations.set(handler.name, record);
    this.syncMode(this.mode);
    return () => {
      if (this.registrations.get(handler.name) !== record) return;
      this.registrations.delete(handler.name);
      this.suspended.delete(handler);
      release();
      this.syncMode(this.mode);
    };
  }
  syncMode(mode: string): void {
    this.mode = mode;
    const blocked = new Set<string>();
    for (const { options } of this.registrations.values()) {
      if (options.mode === mode) for (const role of options.blocks ?? []) blocked.add(role);
    }
    for (const { handler, options } of this.registrations.values()) {
      const shouldSuspend = options.roles?.some((role) => blocked.has(role)) ?? false;
      if (shouldSuspend && handler.isEnabled()) {
        this.suspended.add(handler);
        handler.disable();
      } else if (!shouldSuspend && this.suspended.delete(handler)) {
        handler.enable();
      }
    }
    this._handlers.refreshCursor();
  }
  dispose(): void {
    for (const record of [...this.registrations.values()].reverse()) record.release();
    this.registrations.clear();
    this.suspended.clear();
    this._handlers.detach();
  }

  constructor(private readonly deps: Dependencies) {
    this._handlers = new HandlerManager();
  }
}
