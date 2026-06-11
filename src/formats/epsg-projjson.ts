import { EPSG_PROJJSON_TABLE } from '../geo/epsg-projjson-data';

const cache = new Map<string, unknown | null>();

function findTableRow(code: string): string | null {
  const firstNeedle = `${code}\t`;
  let start = EPSG_PROJJSON_TABLE.startsWith(firstNeedle) ? 0 : -1;
  if (start === -1) {
    const needle = `\n${firstNeedle}`;
    const index = EPSG_PROJJSON_TABLE.indexOf(needle);
    if (index === -1) return null;
    start = index + 1;
  }

  const valueStart = start + firstNeedle.length;
  const valueEnd = EPSG_PROJJSON_TABLE.indexOf('\n', valueStart);
  return EPSG_PROJJSON_TABLE.slice(valueStart, valueEnd === -1 ? undefined : valueEnd);
}

export function findEpsgProjjson(code: string): unknown | undefined {
  const normalized = code.trim();
  if (!/^\d+$/.test(normalized)) return undefined;

  const cached = cache.get(normalized);
  if (cached !== undefined) return cached ?? undefined;

  const raw = findTableRow(normalized);
  if (!raw) {
    cache.set(normalized, null);
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw);
    cache.set(normalized, parsed);
    return parsed;
  } catch {
    cache.set(normalized, null);
    return undefined;
  }
}

export function findAuthorityProjjson(authority: string, code: string): unknown | undefined {
  return authority.toUpperCase() === 'EPSG' ? findEpsgProjjson(code) : undefined;
}
