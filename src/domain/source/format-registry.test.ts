import { Context } from 'cordis';
import { settleContext } from '../../runtime/context/settle';
import { describe, expect, it } from 'vitest';
import { FormatRegistry, type DatasetFormatPlugin } from './format-registry';
import { TopologySource } from './topology-source';
import { formatsPlugin, formatPlugin } from '../../runtime/providers/formats/plugin';
const dataset = { layers: [], info: { crs_string: 'EPSG:4326' } };
function codec(name = 'custom'): DatasetFormatPlugin {
  return {
    name,
    extensions: ['custom'],
    importBinary: async () => dataset,
    exportFormats: {
      custom: async () => [{ filename: 'result.custom', content: new Uint8Array([1]) }],
    },
    mimeTypes: { custom: 'application/x-custom' },
  };
}
describe('scoped format registry', () => {
  it('isolates registration between workspaces and supports codecs unknown to the core', async () => {
    const first = new FormatRegistry();
    const second = new FormatRegistry();
    const release = first.register(codec());
    expect(second.getFormatForExtension('custom')).toBeUndefined();
    const source = new TopologySource('data', { formats: first });
    await source.setData({ filename: 'test.custom', content: new Uint8Array([1]) });
    expect(source.getDataset()).toBe(dataset);
    expect((await source.export({ format: 'custom' })).type).toBe('application/x-custom');
    release();
    expect(first.list()).toEqual([]);
  });
  it('rejects all collisions before installing anything', () => {
    const formats = new FormatRegistry();
    formats.register(codec());
    expect(() => formats.register(codec())).toThrow('already registered');
    expect(() => formats.register(codec('second'))).toThrow('extension already registered');
    expect(() => formats.register({ ...codec('third'), extensions: ['third'] })).toThrow(
      'Export format already registered',
    );
    expect(formats.list()).toHaveLength(1);
    expect(formats.getFormatForExtension('third')).toBeUndefined();
  });
  it('freezes metadata and keeps old disposers from removing replacements', () => {
    const formats = new FormatRegistry();
    const release = formats.register(codec());
    release();
    formats.register(codec());
    release();
    expect(formats.list()).toHaveLength(1);
    expect(Object.isFrozen(formats.list()[0].extensions)).toBe(true);
    formats.dispose();
    expect(() => formats.register(codec())).toThrow('disposed');
  });
  it('rejects pending reads on unload without waiting for the codec to finish', async () => {
    const formats = new FormatRegistry();
    let finish!: (value: typeof dataset) => void;
    const release = formats.register({
      ...codec(),
      importBinary: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const source = new TopologySource('data', { formats });
    const read = source.setData({ filename: 'test.custom', content: new Uint8Array([1]) });
    const rejection = expect(read).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await rejection;
    finish(dataset);
    await Promise.resolve();
    expect(source.getDataset()).toBeUndefined();
  });
  it('revokes captured export functions and pending exports with their owner', async () => {
    const formats = new FormatRegistry();
    let finish!: (value: []) => void;
    const release = formats.register({
      ...codec(),
      exportFormats: {
        custom: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    });
    const exportFile = formats.getExportHandler('custom')!;
    const result = exportFile(dataset);
    const rejection = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    release();
    await rejection;
    await expect(exportFile(dataset)).rejects.toMatchObject({ name: 'AbortError' });
    finish([]);
  });
  it('participates in the normal plugin lifecycle', async () => {
    const runtime = new Context();
    runtime.plugin(formatsPlugin);
    const feature = runtime.plugin(formatPlugin(codec()));
    await settleContext(runtime);
    expect(runtime.formats.list()).toHaveLength(1);
    await feature.dispose();
    expect(runtime.formats.list()).toEqual([]);
    await runtime.fiber.dispose();
  });
});
