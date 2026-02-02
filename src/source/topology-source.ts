import mapshaper from 'mapshaper';
import { TopologySource as ITopologySource } from './source';
import { Bounds } from '../geo/bounds';

export class TopologySource implements ITopologySource {
  public id: string;
  public type: 'topology' = 'topology';
  private _dataset: any;

  constructor(id: string) {
    this.id = id;
  }

  async load(input?: { filename: string, content: Uint8Array }): Promise<void> {
    if (!input) return;

    const inputFiles = {
      [input.filename]: input.content
    };

    const cmd = `-i ${input.filename} -merge-layers`;
    const commands = mapshaper.internal.parseCommands(cmd);

    // Inject input files into the import command
    if (commands.length > 0 && commands[0].name === 'i') {
      commands[0].options.input = inputFiles;
    }

    this._dataset = await new Promise((resolve, reject) => {
      mapshaper.internal.runParsedCommands(commands, new mapshaper.internal.Job(), (err: any, job: any) => {
        if (err) reject(err);
        else {
          const targets = job.catalog.getDefaultTargets();
          if (targets.length > 0) {
            resolve(targets[0].dataset);
          } else {
            reject(new Error('No layers found in dataset'));
          }
        }
      });
    });
  }

  getExtent(): Bounds {
    if (!this._dataset) return new Bounds();
    const info = mapshaper.internal.getDatasetBounds(this._dataset);
    return new Bounds(info.xmin, info.ymin, info.xmax, info.ymax);
  }

  getArcs(): any {
    return this._dataset?.arcs;
  }

  getLayers(): any[] {
    return this._dataset?.layers || [];
  }
}
