/**
 * Worker entry. Owns one mapshaper instance and runs commands on packed
 * dataset payloads received from the main thread.
 *
 * Wire protocol (see `MapshaperWorkerPool` for the matching main-thread side):
 *
 *   main → worker:  { id: number, type: 'run', cmd: string, packed: PackedSession, inputFiles?: object }
 *   worker → main:  { id, type: 'ok', packed: PackedSession }
 *                |  { id, type: 'error', message: string }
 *
 * `PackedSession` is the plain-object form produced by
 * `mapshaper.internal.exportDatasetsToPack(datasets, { compact: false })`
 * — typed-array buffers wrapped as `Uint8Array`s, layers + info as plain
 * JS objects. structured-clone friendly so postMessage round-trips with
 * zero string-copy.
 */
import '../shim';
import 'mapshaper';
import mapshaper from 'mapshaper';

interface RunRequest {
  id: number;
  type: 'run';
  cmd: string;
  packed: any;
  inputFiles?: Record<string, Uint8Array | string>;
}

async function handleRun(req: RunRequest): Promise<void> {
  try {
    const { id, cmd, packed, inputFiles } = req;

    // Parse first — fail fast on malformed commands without paying the cost
    // of restoring a potentially-large dataset.
    const commands = mapshaper.internal.parseCommands(cmd);
    if (inputFiles) {
      for (const c of commands) {
        if (c.options) c.options.input = inputFiles;
      }
    }

    const restored = await mapshaper.internal.restoreSessionData(packed);
    const datasets = restored.datasets;
    if (!datasets || datasets.length === 0) {
      throw new Error('worker: packed payload contained no datasets');
    }

    // mapshaper writes results back into a Job's catalog. We seed the
    // catalog with the first restored dataset (matches main-thread runner).
    const job = new mapshaper.internal.Job();
    job.catalog.addDataset(datasets[0]);

    const finished: any = await new Promise((resolve, reject) => {
      mapshaper.internal.runParsedCommands(commands, job, (err: any, fin: any) => {
        if (err) reject(err);
        else resolve(fin);
      });
    });

    const targets = finished.catalog.getDefaultTargets();
    const result = targets.length > 0 ? targets[0].dataset : datasets[0];

    const repacked = await mapshaper.internal.exportDatasetsToPack(
      [result],
      { compact: false },
    );

    (self as unknown as Worker).postMessage({ id, type: 'ok', packed: repacked });
  } catch (err: any) {
    const message = err?.message ?? String(err);
    (self as unknown as Worker).postMessage({ id: req.id, type: 'error', message });
  }
}

// Serialize handleRun invocations. mapshaper has module-level state
// (parser tables, internal caches) that isn't reentrant-safe inside one
// worker; concurrent async handleRun calls would interleave arbitrary
// awaits and could corrupt that state. Browser workers process messages
// one at a time, but our async function returns a promise immediately —
// without this queue, the next message starts before the current finishes
// awaiting. The .catch() prevents one failure from permanently stalling
// the queue (handleRun already swallows its own errors via try/catch +
// posting an error message, so this is belt-and-suspenders).
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent) => {
  const data = e.data as RunRequest;
  if (data && data.type === 'run') {
    queue = queue.then(() => handleRun(data)).catch(() => undefined);
  }
};
