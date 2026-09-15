import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const config = JSON.parse(readFileSync(resolve(root, 'typedoc.json'), 'utf8'));
const plugin = readFileSync(resolve(root, 'scripts/typedoc-hide-internals.mjs'), 'utf8');

describe('TypeDoc configuration', () => {
  it('builds every supported public entry point and excludes @internal declarations', () => {
    expect(config.entryPoints).toEqual([
      'src/index.ts',
      'src/integrations/arrow/index.ts',
      'src/integrations/duckdb/index.ts',
      'src/runtime/context/index.ts',
      'src/runtime/services/index.ts',
      'src/runtime/providers/index.ts',
      'src/runtime/plugins/index.ts',
      'src/runtime/presets/index.ts',
      'src/runtime/ai/index.ts',
      'src/integrations/maplibre/index.ts',
      'src/integrations/geopackage/index.ts',
    ]);
    expect(config.excludeInternal).toBe(true);
    expect(config.treatWarningsAsErrors).toBe(true);
    expect(config.plugin).toEqual(['./scripts/typedoc-hide-internals.mjs']);
  });

  it('keeps the plugin focused on internal host filtering and example links', () => {
    expect(plugin).toContain('Converter.EVENT_RESOLVE_END');
    expect(plugin).toContain('Runnable examples:');
    expect(plugin).toContain("reflection.name?.startsWith('_')");
    expect(plugin).not.toContain('is a public emap');
    expect(plugin).not.toContain('Must be assignable to');
    expect(plugin).not.toContain('INTERNAL_HOST_SURFACE_NAMES');
  });

  it('keeps intentionallyNotExported entries unique', () => {
    expect(config.intentionallyNotExported).toEqual([...new Set(config.intentionallyNotExported)]);
  });
});
