export interface ImportResourceLimits {
  /** Maximum raw bytes accepted from one logical import request. */
  maxInputBytes: number;
}

export const DEFAULT_IMPORT_RESOURCE_LIMITS: Readonly<ImportResourceLimits> = Object.freeze({
  maxInputBytes: 2 * 1024 ** 3,
});

export function resolveImportResourceLimits(
  limits: Partial<ImportResourceLimits> | undefined,
): ImportResourceLimits {
  const resolved = { ...DEFAULT_IMPORT_RESOURCE_LIMITS, ...limits };
  if (!Number.isSafeInteger(resolved.maxInputBytes) || resolved.maxInputBytes <= 0) {
    throw new RangeError('Invalid import resource limit: maxInputBytes');
  }
  return resolved;
}

export function assertImportInputBytes(byteLength: number, maxInputBytes: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > maxInputBytes) {
    throw new RangeError(`Import input byte limit exceeded: ${byteLength} > ${maxInputBytes}`);
  }
}
