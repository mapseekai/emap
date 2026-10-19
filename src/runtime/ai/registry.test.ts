import { contextFibers } from '../context/inspection';
import { settleContext } from '../context/settle';
import { mapshaperProcessingPlugin } from '../../integrations/mapshaper/plugin';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityRegistry } from './registry';
import { describeAgentTools, invokeAgentTool } from './agent-tools';
import type { CapabilityDefinition } from '../services/capabilities';
import { Emap } from '../../engine/map/map';
import { TopologySource } from '../../domain/source/topology-source';
const definition = (overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition => ({
  id: 'test.read',
  title: 'Read',
  description: 'Read a number',
  category: 'test',
  inputSchema: {
    type: 'object',
    properties: { value: { type: 'number', minimum: 0 } },
    required: ['value'],
    additionalProperties: false,
  },
  effects: ['read'],
  cost: 'low',
  crs: 'any',
  undoable: false,
  execute: (input) => input.value,
  ...overrides,
});
describe('capability registry', () => {
  it('executes ordinary methods with the registered definition as their receiver', async () => {
    const registry = new CapabilityRegistry();
    const tool = definition();
    tool.execute = function () {
      return this.id;
    };
    registry.register(tool);
    await expect(registry.execute(tool.id, { value: 1 })).resolves.toBe(tool.id);
    registry.dispose();
  });
  it('isolates definitions and freezes published metadata', () => {
    const first = new CapabilityRegistry();
    const second = new CapabilityRegistry();
    const tool = definition();
    first.register(tool);
    expect(second.list()).toEqual([]);
    expect(Object.isFrozen(first.get(tool.id)?.inputSchema.properties)).toBe(true);
    expect(first.get(tool.id)).not.toHaveProperty('execute');
    expect(() => first.register(tool)).toThrow('already registered');
    first.dispose();
    second.dispose();
  });
  it('validates type, ranges, unknown properties, JSON structure and required fields', async () => {
    const registry = new CapabilityRegistry();
    registry.register(definition());
    for (const value of [
      {},
      { value: '1' },
      { value: -1 },
      { value: NaN },
      { value: 1, extra: 2 },
      { value: () => 1 },
    ]) {
      await expect(registry.execute('test.read', value)).rejects.toThrow();
    }
    const cyclic: Record<string, unknown> = { value: 1 };
    cyclic.self = cyclic;
    await expect(registry.execute('test.read', cyclic)).rejects.toThrow('cycles');
    const getter = vi.fn(() => 1);
    await expect(
      registry.execute('test.read', Object.defineProperty({}, 'value', { get: getter })),
    ).rejects.toThrow('accessors');
    expect(getter).not.toHaveBeenCalled();
    expect(await registry.execute('test.read', { value: 4 })).toBe(4);
    registry.dispose();
  });
  it('rejects agent writes unless authorized by the trusted host', async () => {
    const run = vi.fn();
    const registry = new CapabilityRegistry();
    registry.register(definition({ effects: ['document'], execute: run }));
    await expect(registry.execute('test.read', { value: 1 }, { origin: 'agent' })).rejects.toThrow(
      'authorization',
    );
    expect(run).not.toHaveBeenCalled();
    const authorized = new CapabilityRegistry(() => true);
    authorized.register(definition({ effects: ['document'], execute: run }));
    await authorized.execute('test.read', { value: 1 }, { origin: 'agent' });
    expect(run).toHaveBeenCalledOnce();
    registry.dispose();
    authorized.dispose();
  });
  it('revokes a pending result on unregister and does not remove a replacement', async () => {
    const registry = new CapabilityRegistry();
    let resolve!: (result: number) => void;
    const release = registry.register(
      definition({
        execute: () =>
          new Promise<number>((finish) => {
            resolve = finish;
          }),
      }),
    );
    const pending = registry.execute('test.read', { value: 1 });
    release();
    registry.register(definition());
    release();
    resolve(1);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(registry.list()).toHaveLength(1);
    expect(registry.history()[0].status).toBe('cancelled');
    registry.dispose();
  });
  it('checks lifecycle again after asynchronous authorization', async () => {
    let allow!: (allowed: boolean) => void;
    const registry = new CapabilityRegistry(
      () =>
        new Promise((resolve) => {
          allow = resolve;
        }),
    );
    const run = vi.fn();
    const release = registry.register(definition({ execute: run }));
    const pending = registry.execute('test.read', { value: 1 }, { origin: 'agent' });
    release();
    allow(true);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(run).not.toHaveBeenCalled();
    registry.dispose();
  });
  it('bounds run history and never records arguments', async () => {
    const registry = new CapabilityRegistry();
    registry.register(definition());
    for (let index = 0; index < 210; index++) await registry.execute('test.read', { value: index });
    expect(registry.history()).toHaveLength(200);
    expect(registry.history()[0]).not.toHaveProperty('input');
    registry.dispose();
  });
  it('keeps full geometry local while returning a model-facing dataset summary', async () => {
    const registry = new CapabilityRegistry();
    const dataset = {
      layers: [
        {
          name: 'points',
          geometry_type: 'point',
          shapes: [[[1, 2]]],
          data: {},
        },
      ],
    };
    registry.register(definition({ execute: () => dataset }));
    const result = await invokeAgentTool(registry, 'test.read', { value: 1 });
    expect(result.value).toBe(dataset);
    expect(result.content).toMatchObject({
      kind: 'dataset',
      layers: [{ name: 'points', features: 1 }],
    });
    expect(JSON.stringify(result.content)).not.toContain('shapes');
    expect(describeAgentTools(registry)[0]).toMatchObject({
      name: 'test.read',
      annotations: { readOnlyHint: true },
    });
    registry.dispose();
  });
});
describe('GIS capability integration', () => {
  it('reuses the real operation, history and source state', async () => {
    const map = await Emap.create({
      preset: 'headless',
      authorizeCapability: () => true,
    });
    const source = await TopologySource.fromBytes(
      's',
      new TextEncoder().encode(
        JSON.stringify({
          type: 'Feature',
          properties: { name: 'A' },
          geometry: { type: 'Point', coordinates: [1, 2] },
        }),
      ),
      { filename: 'points.geojson' },
    );
    await map.addSource('s', source);
    await map.capabilities.execute(
      'mapshaper.renameLayer',
      { source: 's', target: 'points', name: 'renamed' },
      { origin: 'agent' },
    );
    expect(source.getLayers()[0].name).toBe('renamed');
    expect(map.canUndo()).toBe(true);
    map.undo();
    expect(source.getLayers()[0].name).toBe('points');
    await map.dispose();
  });
  it('removes capability discovery when its provider disappears', async () => {
    const map = await Emap.create({ preset: 'headless' });
    expect(map.capabilities.get('mapshaper.bufferLayer')).toBeDefined();
    await contextFibers(map.ctx)
      .find((fiber) => fiber.name === 'feature.mapshaper-processing')!
      .dispose();
    await settleContext(map.ctx);
    expect(map.capabilities.get('mapshaper.bufferLayer')).toBeUndefined();
    expect(map.capabilities.get('view.getCRS')).toBeDefined();
    await map.ctx.plugin(mapshaperProcessingPlugin);
    await settleContext(map.ctx);
    expect(map.capabilities.get('mapshaper.bufferLayer')).toBeDefined();
    await map.dispose();
  });
});
