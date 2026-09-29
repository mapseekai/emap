import { createBrowserTestMap } from '../../utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MapshaperWorkerPool } from '../../../src/engine/core/mapshaper-worker-pool';
import { TasklaneTestWorker as TestWorker, flushTasks } from '../../helpers/tasklane-worker';
import { output } from '@mapseekai/tasklane/host';
import { encodeWorkerData } from '../../../src/integrations/mapshaper/binary';
beforeAll(() => {
  TestWorker.cloneMessages = false;
  HTMLCanvasElement.prototype.getContext = () =>
    ({
      scale: () => {},
      clearRect: () => {},
      fillRect: () => {},
      strokeRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      stroke: () => {},
      fill: () => {},
      arc: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      setTransform: () => {},
      drawImage: () => {},
      measureText: () => ({ width: 0 }),
    }) as any;
});
afterEach(() => {
  TestWorker.instances.length = 0;
  document.body.replaceChildren();
});
function container(): HTMLElement {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.appendChild(element);
  return element;
}
function pool(): MapshaperWorkerPool {
  return new MapshaperWorkerPool({
    workerUrl: 'emap-worker.js',
    WorkerCtor: TestWorker as unknown as typeof Worker,
  });
}
describe('Emap worker pool ownership', () => {
  it('does not adopt an injected pool when worker mode is disabled', async () => {
    const workerPool = pool();
    const map = await createBrowserTestMap({
      container: container(),
      useWorker: false,
      workerPool,
    });
    await map.dispose();
    const job = workerPool.run('-clip', { datasets: [] });
    void job.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushTasks();
    expect(TestWorker.instances).toHaveLength(1);
    const bytes = encodeWorkerData({ datasets: ['still-usable'] });
    TestWorker.instances[0].pending[0].resolve(output(bytes, [bytes.buffer]));
    await expect(job).resolves.toEqual({ datasets: ['still-usable'] });
    workerPool.destroy();
  });
  it('destroys an injected pool adopted by enabled worker mode', async () => {
    const workerPool = pool();
    const map = await createBrowserTestMap({ container: container(), useWorker: true, workerPool });
    await map.dispose();
    await expect(workerPool.run('-clip', { datasets: [] })).rejects.toThrow(
      'MapshaperWorkerPool: destroyed',
    );
  });
});

it('map disposal waits for the painter physical cleanup barrier', async () => {
  const map = await createBrowserTestMap({ container: container() });
  const painter = Reflect.get(map.ctx.render, '_painter');
  let release!: () => void;
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });
  Object.defineProperty(painter, 'closed', { get: () => closed });
  let disposed = false;
  painter.dispose = () => {
    disposed = true;
  };
  let finished = false;
  const closing = map.dispose().then(() => {
    finished = true;
  });
  await flushTasks();
  expect(disposed).toBe(true);
  expect(finished).toBe(false);
  release();
  await closing;
  expect(finished).toBe(true);
});

it('map disposal retries failed painter cleanup without destroying a borrowed runtime', async () => {
  const { createEmapWorkerRuntime } = await import('../../../src/integrations/tasklane/runtime');
  const runtime = createEmapWorkerRuntime();
  const map = await createBrowserTestMap({ container: container(), workerRuntime: runtime });
  const painter = Reflect.get(map.ctx.render, '_painter');
  let calls = 0;
  let closed = Promise.resolve();
  Object.defineProperty(painter, 'closed', { get: () => closed });
  painter.dispose = () => {
    closed = ++calls === 1 ? Promise.reject(new Error('transient cleanup')) : Promise.resolve();
    void closed.catch(() => {});
  };
  try {
    await expect(map.dispose()).rejects.toThrow('Resource disposal');
    expect(calls).toBe(1);
    await map.dispose();
    expect(calls).toBe(2);
    const scope = runtime.createScope('still-borrowed');
    await scope.dispose();
  } finally {
    await runtime.dispose();
  }
});
