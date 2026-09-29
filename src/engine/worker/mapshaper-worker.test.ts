vi.mock('../../integrations/mapshaper/binary', () => ({
  decodeWorkerData: async () => ({ datasets: [] }),
}));
import { expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => ({ current: null as any }));
vi.mock('@mapseekai/tasklane/host', () => ({
  browserHost: () => ({}),
  serve: (_port: unknown, value: unknown) => {
    handlers.current = value;
  },
}));
const runParsedCommands = vi.fn((_commands, _job, callback) => {
  callback(null, { catalog: { getDefaultTargets: () => [] } });
});

vi.stubGlobal('self', {});
vi.mock('mapshaper', () => ({
  default: {
    internal: {
      unpackSessionData: async () => ({ datasets: [], payload: { datasets: [] } }),
      parseCommands: () => [{ name: 'target', options: {} }],
      restoreSessionData: async () => ({ datasets: [{ layers: [] }] }),
      exportDatasetsToPack: vi.fn(),
      runParsedCommands,
      Job: class {
        catalog = { addDataset: vi.fn() };
      },
    },
  },
}));

it('reports an error when a command produces no default target', async () => {
  await import('./mapshaper-worker');

  await expect(
    handlers.current.mapshaper({ cmd: '-target missing', bytes: new Uint8Array() }),
  ).rejects.toThrow('mapshaper command completed but produced no default target');
});
