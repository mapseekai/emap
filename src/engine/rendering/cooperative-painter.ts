import type { AffineTransform } from '../../domain/geo/transform';
import type {
  ArcCollection,
  FeatureShape,
  PointStyle,
  StrokeStyle,
} from '../../shared/types/mapshaper-types';
import type { ArrowDotPathOptions, CorePainter, PolygonFillOptions } from './painter';

const ARC_CHUNK = 512;
const SHAPE_CHUNK = 512;
const POINT_CHUNK = 1000;

type Command =
  | {
      kind: 'paths';
      shapes: readonly (FeatureShape | null | undefined)[];
      style: StrokeStyle;
      arcs: ArcCollection;
      filter?: (i: number) => boolean;
      indices?: Uint32Array;
      revision?: number;
    }
  | {
      kind: 'arcs';
      arcs: ArcCollection;
      style: StrokeStyle;
      filter?: (i: number) => boolean;
      ids?: Uint32Array | Int32Array;
      arrowDot?: ArrowDotPathOptions;
    }
  | {
      kind: 'points';
      shapes: readonly (FeatureShape | null | undefined)[];
      style: PointStyle;
      indices?: Uint32Array;
      components?: Uint32Array;
    }
  | {
      kind: 'fill';
      shapes: readonly (FeatureShape | null | undefined)[];
      arcs: ArcCollection;
      color: string;
      filter?: (i: number) => boolean;
      opacity?: number;
      options?: PolygonFillOptions;
    };

function range(start: number, end: number): Uint32Array {
  const out = new Uint32Array(end - start);
  for (let i = 0; i < out.length; i++) out[i] = start + i;
  return out;
}

function sliceIndices(ids: Uint32Array | undefined, start: number, end: number): Uint32Array {
  return ids ? ids.subarray(start, end) : range(start, end);
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Records vector drawing commands, then replays them in cancellable chunks. */
export class CooperativePainter implements CorePainter {
  private commands: Command[] = [];

  constructor(private readonly target: CorePainter) {}

  reset(): void {
    this.commands.length = 0;
  }

  replay(isCurrent: () => boolean): boolean | Promise<boolean> {
    if (this.estimatedChunks() <= 1) {
      if (!isCurrent()) return false;
      for (const command of this.commands) this.replayWhole(command);
      return isCurrent();
    }
    return this.replayChunked(isCurrent);
  }

  private estimatedChunks(): number {
    let chunks = 0;
    for (const command of this.commands) {
      if (command.kind === 'arcs') {
        if (command.arrowDot) chunks += 1;
        else chunks += Math.ceil((command.ids?.length ?? command.arcs.size()) / ARC_CHUNK);
      } else if (command.kind === 'paths') {
        chunks += Math.ceil((command.indices?.length ?? command.shapes.length) / SHAPE_CHUNK);
      } else if (command.kind === 'points') {
        chunks += Math.ceil((command.indices?.length ?? command.shapes.length) / POINT_CHUNK);
      } else if (command.options?.styleBuckets) {
        for (const ids of command.options.styleBuckets.buckets) {
          chunks += Math.ceil(ids.length / SHAPE_CHUNK);
        }
      } else {
        chunks += Math.ceil(
          (command.options?.shapeIndices?.length ?? command.shapes.length) / SHAPE_CHUNK,
        );
      }
      if (chunks > 1) return chunks;
    }
    return chunks;
  }

  private replayWhole(command: Command): void {
    if (command.kind === 'arcs') {
      this.target.drawArcs(
        command.arcs,
        command.style,
        command.filter,
        command.ids,
        command.arrowDot,
      );
    } else if (command.kind === 'paths') {
      this.target.drawPaths(
        command.shapes,
        command.style,
        command.arcs,
        command.filter,
        command.indices,
        command.revision,
      );
    } else if (command.kind === 'points') {
      this.target.drawPoints(command.shapes, command.style, command.indices, command.components);
    } else {
      this.target.drawPolygonFill(
        command.shapes,
        command.arcs,
        command.color,
        command.filter,
        command.opacity,
        command.options,
      );
    }
  }

  private async replayChunked(isCurrent: () => boolean): Promise<boolean> {
    for (const command of this.commands) {
      if (!isCurrent()) return false;
      if (command.kind === 'arcs' && command.arrowDot) {
        this.target.drawArcs(
          command.arcs,
          command.style,
          command.filter,
          command.ids,
          command.arrowDot,
        );
        await yieldToBrowser();
        continue;
      }
      if (command.kind === 'arcs') {
        const count = command.ids?.length ?? command.arcs.size();
        for (let start = 0; start < count; start += ARC_CHUNK) {
          if (!isCurrent()) return false;
          const end = Math.min(count, start + ARC_CHUNK);
          const ids = command.ids ? command.ids.subarray(start, end) : range(start, end);
          this.target.drawArcs(command.arcs, command.style, command.filter, ids);
          if (end < count || this.hasCommandsAfter(command)) await yieldToBrowser();
        }
        continue;
      }
      if (command.kind === 'paths') {
        const count = command.indices?.length ?? command.shapes.length;
        for (let start = 0; start < count; start += SHAPE_CHUNK) {
          if (!isCurrent()) return false;
          const end = Math.min(count, start + SHAPE_CHUNK);
          this.target.drawPaths(
            command.shapes,
            command.style,
            command.arcs,
            command.filter,
            sliceIndices(command.indices, start, end),
            command.revision,
          );
          if (end < count || this.hasCommandsAfter(command)) await yieldToBrowser();
        }
        continue;
      }
      if (command.kind === 'points') {
        const count = command.indices?.length ?? command.shapes.length;
        for (let start = 0; start < count; start += POINT_CHUNK) {
          if (!isCurrent()) return false;
          const end = Math.min(count, start + POINT_CHUNK);
          this.target.drawPoints(
            command.shapes,
            command.style,
            sliceIndices(command.indices, start, end),
            command.components?.subarray(start, end),
          );
          if (end < count || this.hasCommandsAfter(command)) await yieldToBrowser();
        }
        continue;
      }
      const options = command.options ?? {};
      const buckets = options.styleBuckets;
      if (buckets) {
        for (let b = 0; b < buckets.buckets.length; b++) {
          const ids = buckets.buckets[b];
          for (let start = 0; start < ids.length; start += SHAPE_CHUNK) {
            if (!isCurrent()) return false;
            const end = Math.min(ids.length, start + SHAPE_CHUNK);
            this.target.drawPolygonFill(
              command.shapes,
              command.arcs,
              command.color,
              command.filter,
              command.opacity,
              {
                ...options,
                styleBuckets: { buckets: [ids.subarray(start, end)], colors: [buckets.colors[b]] },
              },
            );
            if (
              end < ids.length ||
              b + 1 < buckets.buckets.length ||
              this.hasCommandsAfter(command)
            ) {
              await yieldToBrowser();
            }
          }
        }
      } else {
        const ids = options.shapeIndices;
        const count = ids?.length ?? command.shapes.length;
        for (let start = 0; start < count; start += SHAPE_CHUNK) {
          if (!isCurrent()) return false;
          const end = Math.min(count, start + SHAPE_CHUNK);
          this.target.drawPolygonFill(
            command.shapes,
            command.arcs,
            command.color,
            command.filter,
            command.opacity,
            {
              ...options,
              shapeIndices: sliceIndices(ids, start, end),
            },
          );
          if (end < count || this.hasCommandsAfter(command)) await yieldToBrowser();
        }
      }
    }
    return isCurrent();
  }

  private hasCommandsAfter(command: Command): boolean {
    return this.commands[this.commands.length - 1] !== command;
  }

  drawPaths(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: StrokeStyle,
    arcs: ArcCollection,
    filter?: (i: number) => boolean,
    shapeIndices?: Uint32Array,
    geometryRevision?: number,
  ): void {
    this.commands.push({
      kind: 'paths',
      shapes,
      style,
      arcs,
      filter,
      indices: shapeIndices,
      revision: geometryRevision,
    });
  }
  drawArcs(
    arcs: ArcCollection,
    style: StrokeStyle,
    filter?: (i: number) => boolean,
    arcIds?: Uint32Array | Int32Array,
    arrowDot?: ArrowDotPathOptions,
  ): void {
    this.commands.push({ kind: 'arcs', arcs, style, filter, ids: arcIds, arrowDot });
  }
  drawPoints(
    shapes: readonly (FeatureShape | null | undefined)[],
    style: PointStyle,
    shapeIndices?: Uint32Array,
    componentIndices?: Uint32Array,
  ): void {
    this.commands.push({
      kind: 'points',
      shapes,
      style,
      indices: shapeIndices,
      components: componentIndices,
    });
  }
  drawPolygonFill(
    shapes: readonly (FeatureShape | null | undefined)[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
    options?: PolygonFillOptions,
  ): void {
    this.commands.push({ kind: 'fill', shapes, arcs, color: fillColor, filter, opacity, options });
  }
  drawRasterImage(...args: Parameters<CorePainter['drawRasterImage']>): void {
    this.target.drawRasterImage(...args);
  }
  clear(): void {
    this.target.clear();
  }
  resize(width: number, height: number): void {
    this.target.resize(width, height);
  }
  setTransform(transform: AffineTransform): void {
    this.target.setTransform(transform);
  }
  setPixelRatio(ratio: number): void {
    this.target.setPixelRatio(ratio);
  }
}
