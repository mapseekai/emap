import { expect, it, vi } from 'vitest';

const postMessage = vi.fn();
const runParsedCommands = vi.fn((_commands, _job, callback) => {
  callback(null, { catalog: { getDefaultTargets: () => [] } });
});

vi.stubGlobal('self', { postMessage, onmessage: null });
vi.mock('mapshaper', () => ({
  default: {
    internal: {
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

  self.onmessage?.({
    data: { id: 7, type: 'run', cmd: '-target missing', packed: {} },
  } as MessageEvent);

  await vi.waitFor(() => {
    expect(postMessage).toHaveBeenCalledWith({
      id: 7,
      type: 'error',
      message: 'mapshaper command completed but produced no default target',
    });
  });
});
