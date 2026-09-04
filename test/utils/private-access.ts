export function setPrivate(target: object, key: string, value: unknown): void {
  Reflect.set(target, key, value);
}

export function callPrivate<T>(target: object, key: string, ...args: unknown[]): T {
  return Reflect.get(target, key).apply(target, args) as T;
}
