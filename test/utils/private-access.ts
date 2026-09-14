import { fixtureSet, fixtureCall } from './plugin-test-map';
export function setPrivate(target: object, key: string, value: unknown): void {
  fixtureSet(target, key, value);
}
export function callPrivate<T>(target: object, key: string, ...args: unknown[]): T {
  return fixtureCall<T>(target, key, ...args);
}
