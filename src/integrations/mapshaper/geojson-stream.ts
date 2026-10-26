import { createStreamingGeoJSONParser } from './adapter';
import {
  assertImportInputBytes,
  DEFAULT_IMPORT_RESOURCE_LIMITS,
} from '../../shared/import-resource-limits';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';

/** Streaming FeatureCollection framing. JSON.parse validates each complete feature and metadata. */
export class GeoJSONFeatureFramer {
  private phase: 'header' | 'features' | 'tail' = 'header';
  private quoted = false;
  private escaped = false;
  private depth = 0;
  private token = '';
  private lastString = '';
  private key = '';
  private pending = '';
  private header = '';
  private tail = '';
  private expectValue = true;
  private hasValue = false;
  private afterComma = false;
  // Numbers and coordinate-array brackets cannot end a Feature object. Let the
  // native scanner skip them; JSON.parse still validates its complete syntax.
  private readonly featureTokens = /[{}"\\]/g;
  count = 0;
  constructor(private consume: (value: unknown) => void) {}

  private scanFeature(text: string, start: number): number {
    const tokens = this.featureTokens;
    tokens.lastIndex = start;
    if (this.escaped && start < text.length) {
      this.escaped = false;
      tokens.lastIndex++;
    }
    let token: RegExpExecArray | null;
    while ((token = tokens.exec(text))) {
      const c = token[0];
      if (this.quoted) {
        if (c === '\\') {
          if (tokens.lastIndex === text.length) this.escaped = true;
          else tokens.lastIndex++;
        } else if (c === '"') this.quoted = false;
      } else if (c === '"') this.quoted = true;
      else if (c === '{') this.depth++;
      else if (c === '}' && --this.depth === 0) return tokens.lastIndex;
    }
    return text.length;
  }

  private appendFeature(text: string, start: number, end: number): void {
    if (this.pending.length + end - start > 64 * 1024 ** 2)
      throw new RangeError('A single GeoJSON feature exceeds the 64 MiB parsing window.');
    this.pending += text.slice(start, end);
  }

  push(text: string): void {
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (this.phase === 'features' && this.depth > 0) {
        const end = this.scanFeature(text, i);
        this.appendFeature(text, start, end);
        if (this.depth === 0) {
          const value = JSON.parse(this.pending) as { type?: string };
          if (value?.type !== 'Feature')
            throw new SyntaxError('FeatureCollection contains a non-Feature.');
          this.consume(value);
          this.count++;
          this.hasValue = true;
          this.pending = '';
        }
        start = end;
        i = end - 1;
        continue;
      }
      const c = text[i];
      if (this.phase === 'tail') {
        this.tail += text.slice(i);
        break;
      }
      if (this.quoted) {
        if (this.phase === 'header' && this.depth === 1) this.token += c;
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') {
          this.quoted = false;
          if (this.phase === 'header' && this.depth === 1)
            this.lastString = JSON.parse('"' + this.token) as string;
        }
        continue;
      }
      if (c === '"') {
        if (this.phase === 'features') throw new SyntaxError('Expected a GeoJSON Feature object.');
        this.quoted = true;
        this.token = '';
        continue;
      }
      if (this.phase === 'header') {
        if (c === ':' && this.depth === 1) this.key = this.lastString;
        if (c === '[' && this.depth === 1 && this.key === 'features') {
          this.header += text.slice(start, i);
          this.phase = 'features';
          this.depth = 0;
          start = i + 1;
        } else if (c === '{' || c === '[') this.depth++;
        else if (c === '}' || c === ']') this.depth--;
      } else {
        if (this.depth === 0) {
          if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
            start = i + 1;
            continue;
          }
          if (c === ']') {
            if (this.afterComma) throw new SyntaxError('Trailing comma in GeoJSON features.');
            this.phase = 'tail';
            this.tail = ']';
            start = i + 1;
            continue;
          }
          if (c === ',') {
            if (this.expectValue || !this.hasValue)
              throw new SyntaxError('Unexpected GeoJSON feature separator.');
            this.expectValue = true;
            this.afterComma = true;
            start = i + 1;
            continue;
          }
          if (c !== '{' || !this.expectValue)
            throw new SyntaxError('Expected a GeoJSON Feature object.');
          start = i;
          this.pending = '';
          this.expectValue = false;
          this.afterComma = false;
        }
        if (c === '{') this.depth = 1;
      }
    }
    if (this.phase === 'header') this.header += text.slice(start);
    else if (this.phase === 'features' && this.depth > 0)
      this.appendFeature(text, start, text.length);
    if (this.pending.length > 64 * 1024 ** 2)
      throw new RangeError('A single GeoJSON feature exceeds the 64 MiB parsing window.');
  }
  finish(): Record<string, unknown> {
    if (this.phase !== 'tail' || this.quoted || this.depth !== 0)
      throw new SyntaxError('Incomplete GeoJSON FeatureCollection.');
    const metadata = JSON.parse(this.header.replace(/^\uFEFF/, '') + '[' + this.tail) as Record<
      string,
      unknown
    >;
    if (metadata.type !== 'FeatureCollection')
      throw new SyntaxError('Expected a GeoJSON FeatureCollection.');
    return metadata;
  }
}

/** No full-file ArrayBuffer, decoded string or GeoJSON object tree is retained. */
export async function importGeoJSONFileStream(
  file: File,
  signal: AbortSignal,
  progress: (readBytes: number, features: number) => void = () => {},
): Promise<MapshaperDataset> {
  assertImportInputBytes(file.size, DEFAULT_IMPORT_RESOURCE_LIMITS.maxInputBytes);
  signal.throwIfAborted();
  const parser = createStreamingGeoJSONParser();
  const framer = new GeoJSONFeatureFramer((feature) => parser.parseObject(feature));
  const reader = file.stream().getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let readBytes = 0,
    reported = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      readBytes += value.byteLength;
      framer.push(decoder.decode(value, { stream: true }));
      if (readBytes - reported >= 4 * 1024 ** 2) {
        reported = readBytes;
        progress(readBytes, framer.count);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    framer.push(decoder.decode());
    const metadata = framer.finish();
    signal.throwIfAborted();
    const dataset = parser.done();
    const crs = metadata.crs as { properties?: { name?: unknown } } | undefined;
    const name = crs?.properties?.name;
    dataset.info = {
      ...dataset.info,
      input_files: [file.name],
      input_formats: ['geojson'],
      crs_string: typeof name === 'string' ? name : 'EPSG:4326',
    };
    for (const layer of dataset.layers)
      layer.name ??= typeof metadata.name === 'string' ? metadata.name : file.name;
    progress(readBytes, framer.count);
    return dataset;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
