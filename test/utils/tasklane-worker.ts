import {
  serve,
  type TaskHandlers,
  type HostContext,
  type TaskOutput,
} from '@mapseekai/tasklane/host';
import { vi } from 'vitest';

/** Real tasklane host over an asynchronous, structured-cloning test endpoint. */
export class TasklaneTestWorker extends EventTarget {
  static instances: TasklaneTestWorker[] = [];
  static handlers: TaskHandlers<any> = {};
  // jsdom's realm differs from Node's structuredClone realm; browser suites
  // cover real transfer there, while this option keeps lifecycle tests in-realm.
  static cloneMessages = true;
  readonly requests: Array<{ name: string; payload: any; context: HostContext }> = [];
  readonly pending: Array<{
    resolve(value: TaskOutput<unknown>): void;
    reject(error: unknown): void;
  }> = [];
  private receive?: (message: unknown) => void;
  private stopped = false;
  private readonly stopHost: () => void;
  constructor(
    readonly url?: string | URL,
    readonly options?: WorkerOptions,
  ) {
    super();
    TasklaneTestWorker.instances.push(this);
    const handlers: TaskHandlers<any> = {};
    for (const name of [
      'mapshaper',
      'geometry',
      'msdf',
      'raster',
      'import',
      'next',
      'take',
      'benchmark',
    ]) {
      handlers[name] = (payload, context) => {
        this.requests.push({ name, payload, context });
        const handler = TasklaneTestWorker.handlers[name];
        if (handler) return handler(payload, context);
        return new Promise((resolve, reject) => this.pending.push({ resolve, reject }));
      };
    }
    this.stopHost = serve(
      {
        onMessage: (listener) => {
          this.receive = listener;
          return () => {
            this.receive = undefined;
          };
        },
        postMessage: (message, transfer) => {
          const copy = TasklaneTestWorker.cloneMessages
            ? structuredClone(message, { transfer: [...(transfer ?? [])] })
            : message;
          queueMicrotask(() => {
            if (!this.stopped) this.dispatchEvent(new MessageEvent('message', { data: copy }));
          });
        },
      },
      handlers,
    );
  }
  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const copy = TasklaneTestWorker.cloneMessages
      ? structuredClone(message, { transfer })
      : message;
    queueMicrotask(() => {
      if (!this.stopped) this.receive?.(copy);
    });
  }
  terminate = vi.fn(() => {
    this.stopped = true;
    this.stopHost();
  });
  crash(message = 'Worker failed'): void {
    const event = new Event('error');
    Object.assign(event, { message });
    this.dispatchEvent(event);
  }
}

export async function flushTasks(): Promise<void> {
  // No clock advancement: only drain the finite handshake/prepare/result microtasks.
  for (let i = 0; i < 60; i++) await Promise.resolve();
}
