import type { Context } from 'cordis';

/** Adapt browser cancellation to a native Cordis effect, not a second lifecycle. */
export function pluginSignal(ctx: Context): AbortSignal {
  const controller = new AbortController();
  ctx.effect(
    () => () => controller.abort(new DOMException('Plugin unloaded', 'AbortError')),
    'AbortController',
  );
  return controller.signal;
}
