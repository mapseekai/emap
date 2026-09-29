import { collectTransferables } from './transferables';
import {
  encodeWorkerPacket,
  workerPacketTransfers,
  decodeWorkerData,
  type WorkerDataPacket,
} from '../../integrations/mapshaper/binary';
import '../../integrations/mapshaper/browser-shim';
import 'mapshaper';
import mapshaper from 'mapshaper';
import { serve, browserHost, output } from '@mapseekai/tasklane/host';
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
  cmd?: string;
  commands?: ParsedCommandWire[];
  bytes: Uint8Array | WorkerDataPacket;
  inputFiles?: Record<string, Uint8Array | string>;
}

async function handleRun(req: RunRequest) {
  const { cmd, commands: parsed, bytes, inputFiles } = req;
  const packed = await decodeWorkerData<{ datasets: unknown[]; [key: string]: unknown }>(bytes);

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

  const bytesOut = encodeWorkerPacket(repacked, collectTransferables(repacked));
  return output(bytesOut, workerPacketTransfers(bytesOut));
}
serve(browserHost(self as unknown as Parameters<typeof browserHost>[0]), {
  mapshaper: (payload) => handleRun(payload as RunRequest),
});
