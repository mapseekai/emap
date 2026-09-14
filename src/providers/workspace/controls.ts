import type { EventDispatcher } from '../../core/events';
import { EffectScope } from '../../kernel/scope';
import type { ControlContext } from '../../services/controls';
import type { Control, ControlPosition } from '../../ui/control';
import type { SurfaceContract as SurfaceServiceImpl } from '../../services/contracts/surface';

interface Dependencies {
  events: EventDispatcher;
  surface: Pick<SurfaceServiceImpl, '_controlContainers'>;
  controlContext: ControlContext;
}
interface ControlEntry {
  scope: EffectScope;
  context: ControlContext;
  element?: HTMLElement;
}

/** Owns mounted controls independently of the façade and their registration plugins. */
export class ControlServiceImpl {
  readonly _controls: Control[] = [];
  private readonly entries = new Map<Control, ControlEntry>();
  private readonly factories = new Map<
    string,
    { create: (options?: unknown) => Control; owned: Set<Control> }
  >();
  constructor(private readonly deps: Dependencies) {}

  addControl(control: Control, position: ControlPosition = 'top-left'): void {
    if (this.entries.has(control)) throw new Error('Control is already mounted');
    const container = this.deps.surface._controlContainers.get(position);
    if (!container) throw new Error(`Unknown control position: ${position}`);
    const scope = new EffectScope();
    const context = this.scopedContext(scope);
    const entry: ControlEntry = { scope, context };
    this.entries.set(control, entry);
    try {
      const element = control.onAdd(context);
      entry.element = element;
      element.style.pointerEvents = 'auto';
      container.appendChild(element);
      this._controls.push(control);
    } catch (error) {
      this.entries.delete(control);
      entry.element?.remove();
      try {
        control.onRemove(context);
      } catch (cleanupError) {
        this.deps.events.fire('error', { error: cleanupError });
      }
      void scope
        .dispose()
        .catch((cleanupError) => this.deps.events.fire('error', { error: cleanupError }));
      throw error;
    }
  }

  removeControl(control: Control): void {
    const entry = this.entries.get(control);
    if (!entry) return;
    this.entries.delete(control);
    const index = this._controls.indexOf(control);
    if (index >= 0) this._controls.splice(index, 1);
    for (const factory of this.factories.values()) factory.owned.delete(control);
    try {
      control.onRemove(entry.context);
    } finally {
      entry.element?.remove();
      void entry.scope.dispose().catch((error) => this.deps.events.fire('error', { error }));
    }
  }

  registerFactory(id: string, create: (options?: unknown) => Control): () => void {
    if (this.factories.has(id)) throw new Error(`Control factory already exists: ${id}`);
    const record = { create, owned: new Set<Control>() };
    this.factories.set(id, record);
    return () => {
      if (this.factories.get(id) !== record) return;
      this.factories.delete(id);
      for (const control of [...record.owned]) {
        try {
          this.removeControl(control);
        } catch (error) {
          this.deps.events.fire('error', { error });
        }
      }
      record.owned.clear();
    };
  }

  add(id: string, options?: unknown, position?: ControlPosition): Control {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown control factory: ${id}`);
    const control = factory.create(options);
    this.addControl(control, position);
    factory.owned.add(control);
    return control;
  }
  list(): readonly string[] {
    return [...this.factories.keys()];
  }

  dispose(): void {
    for (const control of [...this._controls]) {
      try {
        this.removeControl(control);
      } catch (error) {
        this.deps.events.fire('error', { error });
      }
    }
    this.factories.clear();
  }

  private scopedContext(scope: EffectScope): ControlContext {
    const base = this.deps.controlContext;
    const context = Object.create(base) as ControlContext;
    context.on = ((...args: unknown[]) => {
      scope.assertActive();
      Reflect.apply(base.on, base, args);
      const type = args[0];
      const listener = args[args.length - 1];
      scope.defer(() => {
        Reflect.apply(base.off, base, [type, listener]);
      });
      return context;
    }) as ControlContext['on'];
    context.off = ((...args: unknown[]) => {
      Reflect.apply(base.off, base, args);
      return context;
    }) as ControlContext['off'];
    return context;
  }
}
