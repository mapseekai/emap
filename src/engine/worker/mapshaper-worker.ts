/**
 * Worker entry. Owns one mapshaper instance and runs commands on packed
 * dataset payloads received from the main thread.
 *
 * Wire protocol (see `MapshaperWorkerPool` for the matching main-thread side):
 *
 *   main → worker:  { id, type: 'run', packed, inputFiles?, cmd?: string, commands?: ParsedCommandWire[] }
 *   worker → main:  { id, type: 'ok', packed: PackedSession }
 *                |  { id, type: 'error', message: string }
 *
 * `cmd` and `commands` are mutually exclusive: legacy callers send a CLI
 * string and the worker parses it; PR-4b callers send pre-built parsed
 * commands and skip the parser entirely.
 *
 * `PackedSession` is the plain-object form produced by
 * `mapshaper.internal.exportDatasetsToPack(datasets, { compact: false })`
 * — typed-array buffers wrapped as `Uint8Array`s, layers + info as plain
 * JS objects. structured-clone friendly so postMessage round-trips with
 * zero string-copy.
 */
import '../../integrations/mapshaper/browser-shim';
import 'mapshaper';
import mapshaper from 'mapshaper';
import { collectTransferables } from './transferables';
import {
  packLayerFields,
  restoreLayerFields,
  runWithLayerFields,
} from '../../domain/source/layer-fields';

interface ParsedCommandWire {
  name: string;
  options: Record<string, unknown>;
}

interface RunRequest {
  id: number;
  type: 'run';
  cmd?: string;
  commands?: ParsedCommandWire[];
  packed: any;
  inputFiles?: Record<string, Uint8Array | string>;
}

async function handleRun(req: RunRequest): Promise<void> {
  try {
    const { id, cmd, commands: parsed, packed, inputFiles } = req;

    // Parse first — fail fast on malformed commands without paying the cost
    // of restoring a potentially-large dataset. PR-4b: skip the parser when
    // the caller already handed us structured commands.
    let commands: any[];
    if (parsed && parsed.length > 0) {
      commands = parsed as any[];
    } else if (typeof cmd === 'string') {
      commands = mapshaper.internal.parseCommands(cmd);
    } else {
      throw new Error('worker: request missing both cmd and commands');
    }
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
    restoreLayerFields(packed, datasets);

    // mapshaper writes results back into a Job's catalog. We seed the
    // catalog with the first restored dataset (matches main-thread runner).
    const job = new mapshaper.internal.Job();
    job.catalog.addDataset(datasets[0]);
    const execute = async (
      activeJob: InstanceType<typeof mapshaper.internal.Job>,
      steps: ParsedCommandWire[],
    ) => {
      const finished: any = await new Promise((resolve, reject) => {
        mapshaper.internal.runParsedCommands(steps, activeJob, (err: any, fin: any) => {
          if (err) reject(err);
          else resolve(fin);
        });
      });
      const targets = finished.catalog.getDefaultTargets();
      if (targets.length === 0)
        throw new Error('mapshaper command completed but produced no default target');
      return targets[0].dataset;
    };
    const result = await runWithLayerFields(
      datasets[0],
      commands,
      (steps) => execute(job, steps),
      (records) => new mapshaper.internal.DataTable(records),
      () => job.catalog.getDefaultTargets().flatMap((target) => target.layers),
      (dataset, steps) => {
        const schemaJob = new mapshaper.internal.Job();
        schemaJob.catalog.addDataset(dataset);
        return execute(schemaJob, steps);
      },
    );

    const repacked = await mapshaper.internal.exportDatasetsToPack([result], { compact: false });
    packLayerFields(repacked, [result]);

    const transferList = collectTransferables(repacked);
    (self as unknown as Worker).postMessage({ id, type: 'ok', packed: repacked }, transferList);
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
