import { EPSG_PROJJSON_PATH_TABLE } from '../geo/epsg-projjson-data';

export const DEFAULT_EPSG_PROJJSON_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@zwishing/epsg-index@3.0.0/';

export interface EpsgProjjsonFetchOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

const pathCache = new Map<string, string | null>();
const projjsonCache = new Map<string, unknown>();

export class EpsgProjjsonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EpsgProjjsonError';
  }
}

function findTableRow(code: string): string | null {
  const firstNeedle = `${code}\t`;
  let start = EPSG_PROJJSON_PATH_TABLE.startsWith(firstNeedle) ? 0 : -1;
  if (start === -1) {
    const needle = `\n${firstNeedle}`;
    const index = EPSG_PROJJSON_PATH_TABLE.indexOf(needle);
    if (index === -1) return null;
    start = index + 1;
  }

  const valueStart = start + firstNeedle.length;
  const valueEnd = EPSG_PROJJSON_PATH_TABLE.indexOf('\n', valueStart);
  return EPSG_PROJJSON_PATH_TABLE.slice(valueStart, valueEnd === -1 ? undefined : valueEnd);
}

export function findEpsgProjjsonPath(code: string): string | undefined {
  const normalized = code.trim();
  if (!/^\d+$/.test(normalized)) return undefined;

  const cached = pathCache.get(normalized);
  if (cached !== undefined) return cached ?? undefined;

  const path = findTableRow(normalized);
  pathCache.set(normalized, path);
  return path ?? undefined;
}

/**
 * Synchronous compatibility hook. Full EPSG PROJJSON definitions are now kept
 * in @zwishing/epsg-index assets and loaded by findAuthorityProjjsonAsync().
 */
export function findEpsgProjjson(_code: string): unknown | undefined {
  return undefined;
}

export function findAuthorityProjjson(authority: string, code: string): unknown | undefined {
  return authority.toUpperCase() === 'EPSG' ? findEpsgProjjson(code) : undefined;
}

export async function findEpsgProjjsonAsync(
  code: string,
  opts: EpsgProjjsonFetchOptions = {},
): Promise<unknown | undefined> {
  const normalized = code.trim();
  const path = findEpsgProjjsonPath(normalized);
  if (!path) return undefined;

  const baseUrl = opts.baseUrl ?? DEFAULT_EPSG_PROJJSON_BASE_URL;
  const url = new URL(path, baseUrl).toString();
  const cached = projjsonCache.get(url);
  if (cached !== undefined) return cached;

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    const error = new EpsgProjjsonError(
      `EPSG:${normalized} PROJJSON fetch requires a fetch implementation for ${url}`,
    );
    throw error;
  }

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (cause) {
    throw new EpsgProjjsonError(`EPSG:${normalized} PROJJSON fetch failed from ${url}`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new EpsgProjjsonError(
      `EPSG:${normalized} PROJJSON fetch failed with HTTP ${response.status} ${response.statusText} from ${url}`.trim(),
    );
  }

  try {
    const projjson = await response.json();
    projjsonCache.set(url, projjson);
    return projjson;
  } catch (cause) {
    throw new EpsgProjjsonError(
      `EPSG:${normalized} PROJJSON asset could not be parsed from ${url}`,
      { cause },
    );
  }
}

export async function findAuthorityProjjsonAsync(
  authority: string,
  code: string,
  opts: EpsgProjjsonFetchOptions = {},
): Promise<unknown | undefined> {
  return authority.toUpperCase() === 'EPSG' ? findEpsgProjjsonAsync(code, opts) : undefined;
}
