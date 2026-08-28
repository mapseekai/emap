import type * as maplibregl from 'maplibre-gl';
import type { MapLibreOverlayStyleService } from './maplibre-service';

export interface PreparedMapLibreOverlayStyle {
  serviceId: string;
  style: maplibregl.StyleSpecification;
  sourceIds: readonly string[];
  layerIds: readonly string[];
  layerVisibility: ReadonlyMap<string, 'visible' | 'none' | undefined>;
  spriteIds: readonly string[];
  glyphs?: string;
  resourceUrls: ReadonlySet<string>;
}

const IMAGE_PROPERTIES = [
  ['layout', 'icon-image'],
  ['paint', 'background-pattern'],
  ['paint', 'fill-pattern'],
  ['paint', 'fill-extrusion-pattern'],
  ['paint', 'line-pattern'],
] as const;

type StyleObject = Record<string, unknown>;

type SpriteEntry = { id: string; url: string };

function overlayPrefix(serviceId: string): string {
  return `emap-overlay:${encodeURIComponent(serviceId)}`;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as StyleObject).map(([key, item]) => [key, cloneValue(item)]),
    ) as T;
  }
  return value;
}
function resolveUrl(url: string, baseUrl: string | undefined): string {
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(url) || !baseUrl) return url;
  try {
    return new URL(url, baseUrl).href.replaceAll('%7B', '{').replaceAll('%7D', '}');
  } catch {
    return url;
  }
}

function assertUnique(ids: readonly string[]): void {
  if (new Set(ids).size !== ids.length) {
    throw new Error('MapLibre overlay style generated IDs must be unique');
  }
}

function normalizeSprite(
  sprite: maplibregl.StyleSpecification['sprite'],
  prefix: string,
  baseUrl: string | undefined,
  resourceUrls: Set<string>,
): { sprites: SpriteEntry[]; imagePrefix?: string } {
  if (!sprite) return { sprites: [] };

  const input: SpriteEntry[] =
    typeof sprite === 'string' ? [{ id: 'default', url: sprite }] : cloneValue(sprite);
  const sprites = input.map(({ id, url }) => {
    const normalizedUrl = resolveUrl(url, baseUrl);
    resourceUrls.add(normalizedUrl);
    return { id: `${prefix}:${id}`, url: normalizedUrl };
  });
  assertUnique(sprites.map((item) => item.id));

  return {
    sprites,
    imagePrefix: typeof sprite === 'string' ? `${prefix}:default:` : `${prefix}:`,
  };
}

function rewriteImageReferences(layer: StyleObject, imagePrefix: string | undefined): void {
  if (!imagePrefix) return;
  for (const [section, property] of IMAGE_PROPERTIES) {
    const values = layer[section];
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    const sectionValues = values as StyleObject;
    const reference = sectionValues[property];
    if (typeof reference === 'string') {
      sectionValues[property] = `${imagePrefix}${reference}`;
    } else if (Array.isArray(reference)) {
      sectionValues[property] = ['concat', imagePrefix, reference];
    }
  }
}

function normalizeSourceUrls(
  source: StyleObject,
  baseUrl: string | undefined,
  resourceUrls: Set<string>,
): void {
  if (typeof source.url === 'string') {
    const normalizedUrl = resolveUrl(source.url, baseUrl);
    source.url = normalizedUrl;
    resourceUrls.add(normalizedUrl);
  }
  if (source.type === 'geojson' && typeof source.data === 'string') {
    const normalizedUrl = resolveUrl(source.data, baseUrl);
    source.data = normalizedUrl;
    resourceUrls.add(normalizedUrl);
  }
  for (const property of ['tiles', 'urls'] as const) {
    if (!Array.isArray(source[property])) continue;
    source[property] = source[property].map((url) => {
      if (typeof url !== 'string') return url;
      const normalizedUrl = resolveUrl(url, baseUrl);
      resourceUrls.add(normalizedUrl);
      return normalizedUrl;
    });
  }
}

export function normalizeMapLibreStyleUrls(
  style: maplibregl.StyleSpecification,
  baseUrl: string,
): maplibregl.StyleSpecification {
  const input = style as unknown as StyleObject;
  const sources: Record<string, maplibregl.SourceSpecification> = {};
  for (const [sourceId, source] of Object.entries(input.sources as StyleObject)) {
    const normalizedSource = cloneValue(source) as StyleObject;
    normalizeSourceUrls(normalizedSource, baseUrl, new Set());
    sources[sourceId] = normalizedSource as maplibregl.SourceSpecification;
  }
  const sprite =
    typeof input.sprite === 'string'
      ? resolveUrl(input.sprite, baseUrl)
      : Array.isArray(input.sprite)
        ? input.sprite.map((entry) => ({
            ...(entry as SpriteEntry),
            url: resolveUrl((entry as SpriteEntry).url, baseUrl),
          }))
        : input.sprite;
  const glyphs =
    typeof input.glyphs === 'string' ? resolveUrl(input.glyphs, baseUrl) : input.glyphs;

  return {
    ...style,
    sources,
    ...(sprite ? { sprite } : {}),
    ...(glyphs ? { glyphs } : {}),
  } as maplibregl.StyleSpecification;
}

export type MapLibreStyleFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface LoadMapLibreOverlayStyleOptions {
  signal: AbortSignal;
  transformRequest?: maplibregl.RequestTransformFunction;
  fetch: MapLibreStyleFetch;
  timeoutMs?: number;
}

export async function loadMapLibreStyle(
  styleUrl: string,
  options: LoadMapLibreOverlayStyleOptions,
): Promise<maplibregl.StyleSpecification> {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(options.signal.reason);
  };
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeoutReason = new DOMException('Timed out', 'TimeoutError');
  const timeout = globalThis.setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(timeoutReason);
  }, timeoutMs);
  options.signal.addEventListener('abort', abort, { once: true });
  if (options.signal.aborted) abort();
  try {
    if (controller.signal.aborted) throw controller.signal.reason;
    const interrupted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      });
    });
    const transformed = options.transformRequest
      ? await Promise.race([
          options.transformRequest(styleUrl, 'Style' as maplibregl.ResourceType),
          interrupted,
        ])
      : undefined;
    const request = transformed ?? { url: styleUrl };
    const response = await Promise.race([
      options.fetch(request.url, {
        signal: controller.signal,
        headers: request.headers,
        method: request.method,
        body: request.body,
        credentials: request.credentials,
        cache: request.cache,
        referrerPolicy: request.referrerPolicy,
      }),
      interrupted,
    ]);
    if (!response.ok) {
      throw new Error(`MapLibre style request failed: HTTP ${response.status}`);
    }
    const style = (await Promise.race([
      response.json(),
      interrupted,
    ])) as maplibregl.StyleSpecification;
    assertMapLibreStyle(style);
    return normalizeMapLibreStyleUrls(style, response.url);
  } catch (error) {
    if (error === timeoutReason) {
      throw new Error(`MapLibre style request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal.removeEventListener('abort', abort);
  }
}

export async function loadMapLibreOverlayStyle(
  service: MapLibreOverlayStyleService,
  options: LoadMapLibreOverlayStyleOptions,
): Promise<PreparedMapLibreOverlayStyle> {
  if (typeof service.style !== 'string') {
    return prepareMapLibreOverlayStyle(service.id, service.style);
  }

  try {
    const style = await loadMapLibreStyle(service.style, options);
    return prepareMapLibreOverlayStyle(service.id, style);
  } catch (error) {
    if (error instanceof Error && error.name !== 'AbortError') {
      error.message = error.message.replace('MapLibre style', 'MapLibre overlay style');
    }
    throw error;
  }
}

function assertMapLibreStyle(style: maplibregl.StyleSpecification): void {
  const input = style as unknown as StyleObject;
  if (input.version !== 8) throw new Error('MapLibre overlay styles must use version 8');
  if (!input.sources || typeof input.sources !== 'object' || Array.isArray(input.sources)) {
    throw new Error('MapLibre overlay style sources must be an object');
  }
  if (!Array.isArray(input.layers))
    throw new Error('MapLibre overlay style layers must be an array');
}

export function prepareMapLibreOverlayStyle(
  serviceId: string,
  style: maplibregl.StyleSpecification,
  baseUrl?: string,
): PreparedMapLibreOverlayStyle {
  assertMapLibreStyle(style);
  const input = style as unknown as StyleObject;
  const inputLayerIds = (input.layers as unknown[]).map((layer) => {
    const id = (layer as StyleObject).id;
    if (typeof id !== 'string') throw new Error('MapLibre overlay style layers require string IDs');
    return `${overlayPrefix(serviceId)}:${id}`;
  });
  assertUnique(inputLayerIds);

  const prefix = overlayPrefix(serviceId);
  const resourceUrls = new Set<string>();
  const sources: Record<string, maplibregl.SourceSpecification> = {};
  const sourceIds = Object.keys(input.sources as StyleObject).map((id) => `${prefix}:${id}`);
  assertUnique(sourceIds);
  for (const [sourceId, source] of Object.entries(input.sources as StyleObject)) {
    const clonedSource = cloneValue(source) as StyleObject;
    normalizeSourceUrls(clonedSource, baseUrl, resourceUrls);
    sources[`${prefix}:${sourceId}`] = clonedSource as maplibregl.SourceSpecification;
  }

  const sprite = normalizeSprite(
    input.sprite as maplibregl.StyleSpecification['sprite'],
    prefix,
    baseUrl,
    resourceUrls,
  );
  const glyphs = typeof input.glyphs === 'string' ? resolveUrl(input.glyphs, baseUrl) : undefined;
  if (glyphs) resourceUrls.add(glyphs);

  const layerVisibility = new Map<string, 'visible' | 'none' | undefined>();
  const layers = (input.layers as unknown[])
    .filter((layer) => (layer as StyleObject).type !== 'background')
    .map((layer) => {
      const clonedLayer = cloneValue(layer) as StyleObject;
      const originalId = clonedLayer.id;
      if (typeof originalId !== 'string')
        throw new Error('MapLibre overlay style layers require string IDs');
      layerVisibility.set(
        `${prefix}:${originalId}`,
        (clonedLayer.layout as StyleObject | undefined)?.visibility as
          | 'visible'
          | 'none'
          | undefined,
      );
      clonedLayer.id = `${prefix}:${originalId}`;
      if (typeof clonedLayer.source === 'string')
        clonedLayer.source = `${prefix}:${clonedLayer.source}`;
      rewriteImageReferences(clonedLayer, sprite.imagePrefix);
      return clonedLayer as maplibregl.LayerSpecification;
    });
  const layerIds = layers.map((layer) => layer.id);
  assertUnique(layerIds);

  return {
    serviceId,
    style: {
      ...cloneValue(input),
      sources,
      layers,
      ...(sprite.sprites.length > 0 ? { sprite: sprite.sprites } : { sprite: undefined }),
      ...(glyphs ? { glyphs } : {}),
    } as maplibregl.StyleSpecification,
    sourceIds,
    layerIds,
    layerVisibility,
    spriteIds: sprite.sprites.map((item) => item.id),
    ...(glyphs ? { glyphs } : {}),
    resourceUrls,
  };
}

function asSpriteArray(sprite: maplibregl.StyleSpecification['sprite']): SpriteEntry[] {
  if (!sprite) return [];
  return typeof sprite === 'string' ? [{ id: 'default', url: sprite }] : cloneValue(sprite);
}

export function composeMapLibreStyle(
  baseStyle: maplibregl.StyleSpecification,
  overlays: readonly { prepared: PreparedMapLibreOverlayStyle; visible: boolean }[],
): maplibregl.StyleSpecification {
  const composed = cloneValue(baseStyle);
  const glyphUrls = new Set<string>();
  if (typeof composed.glyphs === 'string' && composed.glyphs) glyphUrls.add(composed.glyphs);
  for (const { prepared } of overlays) {
    if (prepared.glyphs) glyphUrls.add(prepared.glyphs);
  }
  if (glyphUrls.size > 1) {
    throw new Error('MapLibre overlay glyphs URL conflicts with the active style');
  }

  const sources = { ...composed.sources };
  const layers = [...composed.layers];
  const sourceIds = Object.keys(sources);
  const layerIds = layers.map((layer) => layer.id);
  const overlaySprites = overlays.flatMap(({ prepared }) => asSpriteArray(prepared.style.sprite));
  const sprites =
    overlaySprites.length > 0 ? [...asSpriteArray(composed.sprite), ...overlaySprites] : [];

  for (const { prepared, visible } of overlays) {
    for (const sourceId of prepared.sourceIds) {
      if (sourceIds.includes(sourceId))
        throw new Error('MapLibre overlay style generated IDs must be unique');
      sourceIds.push(sourceId);
      sources[sourceId] = cloneValue(prepared.style.sources[sourceId]);
    }
    for (const layer of prepared.style.layers) {
      if (layerIds.includes(layer.id))
        throw new Error('MapLibre overlay style generated IDs must be unique');
      layerIds.push(layer.id);
      const clonedLayer = cloneValue(layer) as StyleObject;
      if (!visible) {
        clonedLayer.layout = {
          ...(clonedLayer.layout as StyleObject | undefined),
          visibility: 'none',
        };
      }
      layers.push(clonedLayer as maplibregl.LayerSpecification);
    }
  }
  assertUnique(sprites.map((sprite) => sprite.id));

  const [glyphs] = glyphUrls;
  return {
    ...composed,
    sources,
    layers,
    ...(glyphs ? { glyphs } : {}),
    ...(overlaySprites.length > 0 ? { sprite: sprites } : {}),
  };
}
