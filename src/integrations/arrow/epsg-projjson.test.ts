import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  findAuthorityProjjsonAsync,
  findEpsgProjjsonAsync,
  findEpsgProjjsonPath,
} from './epsg-projjson';

const localEpsgIndexFetch: typeof fetch = async (input) => {
  const url = new URL(
    typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
  );
  const match = /\/s\/([^/]+\.json)$/.exec(url.pathname);
  if (!match) return new Response(null, { status: 404 });
  const bytes = await readFile(
    new URL(`../../../node_modules/@zwishing/epsg-index/s/${match[1]}`, import.meta.url),
  );
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const epsg4490AssetUrl = (baseUrl: string): string =>
  new URL(findEpsgProjjsonPath('4490')!, baseUrl).toString();

describe('EPSG PROJJSON asset lookup', () => {
  it('maps EPSG codes to epsg-index asset paths', () => {
    expect(findEpsgProjjsonPath('4490')).toMatch(/^s\/.+\.json$/);
    expect(findEpsgProjjsonPath(' EPSG:4490 ')).toBeUndefined();
  });

  it('loads complete PROJJSON through an injected fetch', async () => {
    const crs = (await findAuthorityProjjsonAsync('EPSG', '4490', {
      fetch: localEpsgIndexFetch,
      baseUrl: 'https://local-epsg.test/pkg/',
    })) as Record<string, unknown>;

    expect(crs).toMatchObject({
      type: 'GeographicCRS',
      name: 'China Geodetic Coordinate System 2000',
      id: { authority: 'EPSG', code: 4490 },
    });
    expect(crs).toHaveProperty('coordinate_system');
  });

  it('rejects when the EPSG asset response is not OK', async () => {
    const baseUrl = 'https://http-failure.example/pkg/';

    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl,
        fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow(
      `EPSG:4490 PROJJSON fetch failed with HTTP 404 Not Found from ${epsg4490AssetUrl(baseUrl)}`,
    );
  });

  it('rejects when the EPSG asset is not JSON', async () => {
    const baseUrl = 'https://json-failure.example/pkg/';

    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl,
        fetch: async () => new Response('{', { status: 200 }),
      }),
    ).rejects.toThrow(
      `EPSG:4490 PROJJSON asset could not be parsed from ${epsg4490AssetUrl(baseUrl)}`,
    );
  });

  it('rejects with fetch diagnostics when the EPSG asset request fails before a response', async () => {
    const baseUrl = 'https://network-failure.example/pkg/';
    const cause = new TypeError('network down');

    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl,
        fetch: async () => {
          throw cause;
        },
      }),
    ).rejects.toMatchObject({
      cause,
      message: `EPSG:4490 PROJJSON fetch failed from ${epsg4490AssetUrl(baseUrl)}`,
    });
  });

  it('rejects when no fetch implementation is available', async () => {
    const originalFetch = globalThis.fetch;
    try {
      Object.defineProperty(globalThis, 'fetch', { value: undefined, configurable: true });
      const baseUrl = 'https://missing-fetch.example/pkg/';

      await expect(
        findEpsgProjjsonAsync('4490', {
          baseUrl,
        }),
      ).rejects.toThrow(
        `EPSG:4490 PROJJSON fetch requires a fetch implementation for ${epsg4490AssetUrl(baseUrl)}`,
      );
    } finally {
      Object.defineProperty(globalThis, 'fetch', { value: originalFetch, configurable: true });
    }
  });

  it('does not cache failed EPSG asset fetches against later retries', async () => {
    await expect(
      findEpsgProjjsonAsync('4490', {
        baseUrl: 'https://retry.example/pkg/',
        fetch: async () => new Response('missing', { status: 404, statusText: 'Not Found' }),
      }),
    ).rejects.toThrow('EPSG:4490 PROJJSON fetch failed with HTTP 404 Not Found');

    const crs = (await findEpsgProjjsonAsync('4490', {
      baseUrl: 'https://retry.example/pkg/',
      fetch: localEpsgIndexFetch,
    })) as Record<string, unknown>;

    expect(crs).toMatchObject({
      type: 'GeographicCRS',
      name: 'China Geodetic Coordinate System 2000',
      id: { authority: 'EPSG', code: 4490 },
    });
  });

  it('returns undefined for numeric EPSG codes that are absent from the path table', async () => {
    await expect(
      findEpsgProjjsonAsync('999999', {
        baseUrl: 'https://absent.example/pkg/',
        fetch: localEpsgIndexFetch,
      }),
    ).resolves.toBeUndefined();
  });
});
