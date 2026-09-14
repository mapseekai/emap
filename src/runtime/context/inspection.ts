import { nativeFiberStates } from './state';
import { Context, type Fiber } from 'cordis';

/** Read the native registry directly; never cache a second plugin graph. */
export function contextFibers(ctx: Context): readonly Fiber[] {
  return [...ctx.registry.values()].flatMap((runtime) => [...runtime.fibers]);
}

export function inspectContext(ctx: Context) {
  const implementations = Reflect.ownKeys(ctx.reflect.store).map(
    (key) => ctx.reflect.store[key as symbol],
  );
  return contextFibers(ctx).map((fiber) => ({
    uid: fiber.uid,
    name: fiber.runtime?.name ?? fiber.name,
    state: nativeFiberStates[fiber.state],
    inject: Object.keys(fiber.inject),
    provides: implementations.filter((impl) => impl.fiber === fiber).map((impl) => impl.name),
    effects: fiber.getEffects(),
  }));
}

export function inspectServices(ctx: Context) {
  return Reflect.ownKeys(ctx.reflect.store)
    .filter((key) => {
      const impl = ctx.reflect.store[key as symbol];
      return ctx[Context.isolate][impl.name] === key;
    })
    .map((key) => {
      const impl = ctx.reflect.store[key as symbol];
      return {
        name: impl.name,
        owner: impl.fiber.name,
        state: nativeFiberStates[impl.fiber.state],
      };
    });
}
