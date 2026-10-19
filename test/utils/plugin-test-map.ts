import type { Plugin } from 'cordis';
import { inspectServices } from '../../src/runtime/context/inspection';
import { settleContext } from '../../src/runtime/context/settle';
import { pluginSignal } from '../../src/runtime/context/cancellation';
import { mapLibrePlugin } from '../../src/integrations/maplibre/plugin';
import { shortcutsPlugin } from '../../src/engine/providers/workspace/shortcuts-plugin';
import { Emap } from '../../src/engine/map/map';
import type { EmapOptions } from '../../src/runtime/services/options';
import { CanvasRenderService } from '../../src/engine/providers/workspace/render';
import { ControlServiceImpl } from '../../src/engine/providers/workspace/controls';
import { InteractionServiceImpl } from '../../src/engine/providers/workspace/interaction';
const retained = new WeakMap<object, object[]>();
const targets = new WeakMap<object, Emap>();
const bound = new WeakMap<object, Map<Function, Function>>();
/** Only tests translate old fixture internals to the actual migrated service owners. */
export function fixtureOwner(target: object, key: PropertyKey): object {
  const map = targets.get(target) ?? target;
  if (!(map instanceof Emap) || !Reflect.get(map, 'ctx')) return target;
  const live = inspectServices(map.ctx)
    .map(({ name }) => map.ctx.get(name))
    .filter(
      (value): value is object =>
        value !== null && (typeof value === 'object' || typeof value === 'function'),
    );
  if (live.length) retained.set(map, live);
  const instances = live.length ? live : (retained.get(map) ?? []);
  if ((key === '_listeners' || key === 'fire') && !!map.ctx.get('mapEvents'))
    return map.ctx.mapEvents;
  if (key === '_scheduleRender' || key === 'render') {
    if (!!map.ctx.get('render')) return map.ctx.render;
  }
  for (const service of instances) {
    if (
      key in service &&
      !['on', 'off', 'once', 'dispose', 'remove', 'ctx', 'ready'].includes(String(key))
    )
      return service;
  }
  return map;
}
export function fixtureGet(target: object, key: string): unknown {
  const owner = fixtureOwner(target, key);
  return Reflect.get(owner, key);
}
export function fixtureSet(target: object, key: string, value: unknown): void {
  const owner = fixtureOwner(target, key);
  // Preserve live references held by LayerRegistry and the query index.
  if (key === '_sources' && Reflect.get(owner, key) instanceof Map && value instanceof Map) {
    const sources = Reflect.get(owner, key) as Map<unknown, unknown>;
    sources.clear();
    for (const [id, source] of value) sources.set(id, source);
    return;
  }
  // The real plugin graph already installed its event hooks; initialization of
  // a fresh fixture must not erase them along with an obsolete facade field.
  if (key === '_listeners' && value && Object.keys(value).length === 0) return;
  Reflect.set(owner, key, value);
}
export function fixtureCall<T>(target: object, key: string, ...args: unknown[]): T {
  const owner = fixtureOwner(target, key);
  return Reflect.apply(Reflect.get(owner, key), owner, args) as T;
}
function bridge(map: Emap): Emap {
  retained.set(
    map,
    inspectServices(map.ctx).map(({ name }) => map.ctx.get(name)),
  );
  const proxy = new Proxy(map, {
    get(target, key, receiver) {
      if (Reflect.has(target, key) && !(typeof key === 'string' && key.startsWith('_')))
        return Reflect.get(target, key, receiver);
      const owner = fixtureOwner(target, key);
      const value = Reflect.get(owner, key);
      if (typeof value !== 'function' || Reflect.get(value, '_isMockFunction')) return value;
      let methods = bound.get(owner);
      if (!methods) {
        methods = new Map();
        bound.set(owner, methods);
      }
      const cached = methods.get(value);
      if (cached) return cached;
      const callable: Function = value.bind(owner);
      methods.set(value, callable);
      return callable;
    },
    set(target, key, value) {
      fixtureSet(target, String(key), value);
      return true;
    },
    defineProperty(target, key, descriptor) {
      const owner = fixtureOwner(target, key);
      return Reflect.defineProperty(owner, key, descriptor);
    },
  });
  targets.set(proxy, map);
  return proxy;
}
/** Real headless runtime plus uninitialized rendering objects for painter unit fixtures. */
export async function createTestMap(): Promise<Emap> {
  const map = await Emap.create({ preset: 'headless' });
  const surface = {
    _container: undefined,
    _canvasContainer: undefined,
    _controlContainers: new Map([
      ['top-left', { appendChild() {} }],
      ['top-right', { appendChild() {} }],
      ['bottom-left', { appendChild() {} }],
      ['bottom-right', { appendChild() {} }],
    ]),
    getCanvasContainer() {
      return this._canvasContainer;
    },
    dispose() {},
  };
  const plugins: Plugin.Object[] = [
    shortcutsPlugin,
    {
      name: 'test.surface',
      provide: ['surface'],
      apply(ctx) {
        ctx.effect(function* () {
          yield ctx.provide('surface', surface as never);
        });
      },
    },
    {
      name: 'test.interaction',
      inject: ['surface'],
      provide: ['interaction'],
      apply(ctx) {
        ctx.effect(function* () {
          yield ctx.provide('interaction', new InteractionServiceImpl({ surface: ctx.surface }));
        });
      },
    },
    {
      name: 'test.controls',
      inject: ['mapEvents', 'surface'],
      provide: ['controls'],
      apply(ctx) {
        ctx.effect(function* () {
          const controls = new ControlServiceImpl({
            ctx,
            events: ctx.mapEvents,
            surface: ctx.surface,
            controlContext: map,
          });
          yield ctx.effect(() => () => controls.dispose());
          yield ctx.provide('controls', controls);
        });
      },
    },
    {
      name: 'test.render',
      inject: ['cache', 'document', 'editState', 'mapEvents', 'layers', 'query', 'surface', 'view'],
      provide: ['render'],
      apply(ctx) {
        const signal = pluginSignal(ctx);
        ctx.effect(function* () {
          const events = ctx.mapEvents;
          const renderer = new CanvasRenderService({
            cache: ctx.cache,
            document: ctx.document,
            editState: ctx.editState,
            events,
            layers: ctx.layers,
            surface: ctx.surface,
            view: ctx.view,
            signal: signal,
            painterFactory: {
              create() {
                throw new Error('Supply a test painter');
              },
            },
          });
          yield ctx.effect(() => () => renderer.dispose());
          yield ctx.provide('render', renderer);
          const clear = (event: { sourceId?: string; layerId?: string }) =>
            renderer.clearLodCache(event);
          events.on('rendercacheclear', clear);
          yield ctx.effect(() => () => {
            events.off('rendercacheclear', clear);
          });
          const render = () => {
            if (
              typeof requestAnimationFrame === 'function' ||
              Reflect.get(renderer._scheduleRender, '_isMockFunction')
            )
              renderer._scheduleRender();
          };
          events.on('renderrequest', render);
          yield ctx.effect(() => () => {
            events.off('renderrequest', render);
          });
          yield ctx.effect(() =>
            ctx.query.setPointLodProvider((source, layer, bounds) =>
              renderer.getPointLodPick(source, layer, bounds),
            ),
          );
        });
      },
    },
  ];
  for (const plugin of plugins) map.ctx.plugin(plugin);
  await settleContext(map.ctx);
  return bridge(map);
}
/** Browser integration tests retain the real editor preset and DOM effects. */
export async function createBrowserTestMap(options: EmapOptions): Promise<Emap> {
  return bridge(
    await Emap.create({
      renderer: 'canvas2d',
      ...options,
      plugins: [mapLibrePlugin, ...(options.plugins ?? [])],
    }),
  );
}
