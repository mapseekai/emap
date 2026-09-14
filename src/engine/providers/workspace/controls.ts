import type { Context, Fiber } from 'cordis';
import type { EventDispatcher } from '../../core/events';
import type { ControlContext } from '../../../runtime/services/controls';
import type { Control, ControlPosition } from '../../../ui/control';
import type { SurfaceContract } from '../../../runtime/services/contracts/surface';

interface Dependencies {
  ctx: Context;
  events: EventDispatcher;
  surface: Pick<SurfaceContract, '_controlContainers'>;
  controlContext: ControlContext;
}
interface ControlEntry {
  fiber: Fiber;
  element?: HTMLElement;
}

/** Controls are native child plugins; Cordis owns their effects and teardown. */
export class ControlServiceImpl {
  readonly _controls: Control[] = [];
  private readonly entries = new Map<Control, ControlEntry>();
  private readonly factories = new Map<
    string,
    { create: (options?: unknown) => Control; owned: Set<Control> }
  >();
  constructor(private readonly deps: Dependencies) {}

  async addControl(control: Control, position: ControlPosition = 'top-left'): Promise<void> {
    if (this.entries.has(control)) throw new Error('Control is already mounted');
    const container = this.deps.surface._controlContainers.get(position);
    if (!container) throw new Error(`Unknown control position: ${position}`);
    const entry = {} as ControlEntry;
    this.entries.set(control, entry);
    const owner = this;
    try {
      entry.fiber = this.deps.ctx.plugin({
        name: `control.${control.constructor.name}`,
        inject: control.inject,
        apply(ctx) {
          const context = owner.scopedContext(ctx);
          ctx.effect(function* () {
            yield () => {
              try {
                control.onRemove(context);
              } catch (error) {
                owner.deps.events.fire('error', { error });
              } finally {
                entry.element?.remove();
                if (ctx.fiber.uid === null) owner.entries.delete(control);
                const index = owner._controls.indexOf(control);
                if (index >= 0) owner._controls.splice(index, 1);
                if (ctx.fiber.uid === null) {
                  for (const factory of owner.factories.values()) factory.owned.delete(control);
                }
              }
            };
            const element = control.onAdd(context);
            entry.element = element;
            element.style.pointerEvents = 'auto';
            container.appendChild(element);
            owner._controls.push(control);
          });
        },
      });
      await entry.fiber.await();
    } catch (error) {
      if (entry.fiber) await entry.fiber.dispose();
      this.entries.delete(control);
      throw error;
    }
  }

  async removeControl(control: Control): Promise<void> {
    await this.entries.get(control)?.fiber.dispose();
  }

  registerFactory(id: string, create: (options?: unknown) => Control): () => Promise<void> {
    if (this.factories.has(id)) throw new Error(`Control factory already exists: ${id}`);
    const record = { create, owned: new Set<Control>() };
    this.factories.set(id, record);
    return async () => {
      if (this.factories.get(id) !== record) return;
      this.factories.delete(id);
      await Promise.all([...record.owned].map((control) => this.removeControl(control)));
      record.owned.clear();
    };
  }

  async add(id: string, options?: unknown, position?: ControlPosition): Promise<Control> {
    const factory = this.factories.get(id);
    if (!factory) throw new Error(`Unknown control factory: ${id}`);
    const control = factory.create(options);
    factory.owned.add(control);
    try {
      await this.addControl(control, position);
    } catch (error) {
      factory.owned.delete(control);
      throw error;
    }
    return control;
  }

  list(): readonly string[] {
    return [...this.factories.keys()];
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((control) => this.removeControl(control)));
    this.factories.clear();
  }

  private scopedContext(ctx: Context): ControlContext {
    const base = this.deps.controlContext;
    const context = Object.create(base) as ControlContext;
    context.on = ((...args: unknown[]) => {
      ctx.effect(() => {
        Reflect.apply(base.on, base, args);
        return () => {
          Reflect.apply(base.off, base, [args[0], args[args.length - 1]]);
        };
      }, 'control event subscription');
      return context;
    }) as ControlContext['on'];
    context.off = ((...args: unknown[]) => {
      Reflect.apply(base.off, base, args);
      return context;
    }) as ControlContext['off'];
    return context;
  }
}
