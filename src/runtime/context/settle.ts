import { nativeFiberStates } from './state';
import { type Context } from 'cordis';
import { contextFibers } from './inspection';

/** Wait only for Cordis's own transitions; this does not resolve or activate dependencies. */
export async function settleContext(ctx: Context): Promise<void> {
  while (true) {
    const fibers = contextFibers(ctx);
    await Promise.all(fibers.map((fiber) => fiber.await()));
    const current = contextFibers(ctx);
    if (
      current.some(
        (fiber) =>
          fiber.state === nativeFiberStates.LOADING || fiber.state === nativeFiberStates.UNLOADING,
      )
    )
      continue;
    // A transition can have created a new failing child after the previous snapshot.
    await Promise.all(current.map((fiber) => fiber.await()));
    return;
  }
}
