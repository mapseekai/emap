import * as Cordis from 'cordis';

/** Upstream's runtime enum is declared as ambient const enum. Reflect preserves
 * isolatedModules support without copying or reimplementing its state values. */
export const nativeFiberStates = Reflect.get(
  Cordis as unknown as Record<string, unknown>,
  'FiberState',
) as Readonly<
  Record<'PENDING' | 'LOADING' | 'ACTIVE' | 'FAILED' | 'DISPOSED' | 'UNLOADING', number> &
    Record<number, string>
>;
