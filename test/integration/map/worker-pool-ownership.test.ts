import { createBrowserTestMap } from '../../utils/plugin-test-map';
// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MapshaperWorkerPool } from '../../../src/engine/core/mapshaper-worker-pool';
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{
    id: number;
  }> = [];
  constructor(_url: string | URL) {
    TestWorker.instances.push(this);
  }
  postMessage(message: { id: number }): void {
    this.posted.push(message);
  }
  terminate(): void {}
  respond(packed: unknown): void {
    const id = this.posted.at(-1)?.id;
    this.onmessage?.({ data: { id, type: 'ok', packed } } as MessageEvent);
  }
}
beforeAll(() => {
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
    expect(TestWorker.instances).toHaveLength(1);
    TestWorker.instances[0].respond({ datasets: ['still-usable'] });
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
