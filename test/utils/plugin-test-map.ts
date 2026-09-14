import { mapLibrePlugin } from '../../src/providers/maplibre/plugin';
import { shortcutsPlugin } from '../../src/providers/workspace/shortcuts-plugin';
import { Emap } from '../../src/map/map';
import type { EmapOptions } from '../../src/services/options';
import { CanvasRenderService } from '../../src/providers/workspace/render';
import { ControlServiceImpl } from '../../src/providers/workspace/controls';
import { InteractionServiceImpl } from '../../src/providers/workspace/interaction';
import {
  CacheService,
  DocumentService,
  EditStateService,
  EventService,
  LayerService,
  QueryService,
  ControlsService,
  RenderService,
  InteractionService,
  SurfaceService,
  ViewService,
} from '../../src/services/keys';
import type { ServiceKey } from '../../src/kernel/service';

const retained = new WeakMap<object, object[]>();
const targets = new WeakMap<object, Emap>();
const bound = new WeakMap<object, Map<Function, Function>>();

/** Only tests translate old fixture internals to the actual migrated service owners. */
export function fixtureOwner(target: object, key: PropertyKey): object {
  const map = targets.get(target) ?? target;
  if (!(map instanceof Emap) || !Reflect.get(map, 'runtime')) return target;
  const live = map.services
    .list()
    .map(({ key }) => map.services.get(key as ServiceKey<unknown>))
    .filter(
      (value): value is object =>
        value !== null && (typeof value === 'object' || typeof value === 'function'),
    );
  if (live.length) retained.set(map, live);
  const instances = live.length ? live : (retained.get(map) ?? []);
  if ((key === '_listeners' || key === 'fire') && map.services.has(EventService))
    return map.services.get(EventService);
  if (key === '_scheduleRender' || key === 'render') {
    if (map.services.has(RenderService)) return map.services.get(RenderService);
  }
  for (const service of instances) {
    if (
      key in service &&
      !['on', 'off', 'once', 'dispose', 'remove', 'services', 'runtime', 'use'].includes(
        String(key),
      )
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
    map.services.list().map(({ key }) => map.services.get(key as ServiceKey<object>)),
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
      let callable = methods.get(value);
      if (!callable) {
        callable = value.bind(owner);
        methods.set(value, callable);
      }
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
export function createTestMap(): Emap {
  const map = new Emap({ preset: 'headless' });
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
  map.runtime.mount([
    shortcutsPlugin,
    {
      id: 'test.surface',
      provides: [SurfaceService],
      setup(ctx) {
        ctx.provide(SurfaceService, surface as never);
      },
    },
    {
      id: 'test.interaction',
      requires: [SurfaceService],
      provides: [InteractionService],
      setup(ctx) {
        ctx.provide(
          InteractionService,
          new InteractionServiceImpl({ surface: ctx.get(SurfaceService) }),
        );
      },
    },
    {
      id: 'test.controls',
      requires: [EventService, SurfaceService],
      provides: [ControlsService],
      setup(ctx) {
        const controls = new ControlServiceImpl({
          events: ctx.get(EventService),
          surface: ctx.get(SurfaceService),
          controlContext: map,
        });
        ctx.defer(() => controls.dispose());
        ctx.provide(ControlsService, controls);
      },
    },
    {
      id: 'test.render',
      requires: [
        CacheService,
        DocumentService,
        EditStateService,
        EventService,
        LayerService,
        QueryService,
        SurfaceService,
        ViewService,
      ],
      provides: [RenderService],
      setup(ctx) {
        const events = ctx.get(EventService);
        const renderer = new CanvasRenderService({
          cache: ctx.get(CacheService),
          document: ctx.get(DocumentService),
          editState: ctx.get(EditStateService),
          events,
          layers: ctx.get(LayerService),
          surface: ctx.get(SurfaceService),
          view: ctx.get(ViewService),
          signal: ctx.signal,
          painterFactory: {
            create() {
              throw new Error('Supply a test painter');
            },
          },
        });
        ctx.defer(() => renderer.dispose());
        ctx.provide(RenderService, renderer);
        const clear = (event: { sourceId?: string; layerId?: string }) =>
          renderer.clearLodCache(event);
        events.on('rendercacheclear', clear);
        ctx.defer(() => {
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
        ctx.defer(() => {
          events.off('renderrequest', render);
        });
        ctx.defer(
          ctx
            .get(QueryService)
            .setPointLodProvider((source, layer, bounds) =>
              renderer.getPointLodPick(source, layer, bounds),
            ),
        );
      },
    },
  ]);
  return bridge(map);
}

/** Browser integration tests retain the real editor preset and DOM effects. */
export function createBrowserTestMap(options: EmapOptions): Emap {
  return bridge(new Emap({ ...options, plugins: [mapLibrePlugin, ...(options.plugins ?? [])] }));
}
