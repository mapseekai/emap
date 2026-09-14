import type { Plugin } from '../kernel/plugin';
import { serviceKey } from '../kernel/service';
import type { DuckDbToolExecutionContext } from './core/tool-definition';
import type { MapshaperDataset } from '../types/mapshaper-types';
import { DuckDbRuntimeScope, type DuckDbRuntimeOptions } from './runtime-scope';
import { duckDbToolbox } from './toolbox';

export interface DuckDbProcessing {
  execute(
    id: string,
    context: Omit<DuckDbToolExecutionContext, 'runtime'>,
  ): Promise<MapshaperDataset>;
}
export const DuckDbService = serviceKey<Pick<DuckDbRuntimeScope, 'get' | 'peek'>>('duckdb.runtime');
export const DuckDbProcessingService = serviceKey<DuckDbProcessing>('duckdb.processing');

/** Supplies one lazy DuckDB runtime. No global setter or eager WASM initialization. */
export function duckDbPlugin(options: DuckDbRuntimeOptions = {}): Plugin {
  return {
    id: 'provider.duckdb',
    provides: [DuckDbService, DuckDbProcessingService],
    setup(ctx) {
      const runtime = new DuckDbRuntimeScope(options);
      ctx.defer(() => runtime.dispose());
      ctx.provide(DuckDbService, runtime);
      ctx.provide(DuckDbProcessingService, {
        async execute(id, input) {
          return ctx.scope.run(async () => {
            const active = await runtime.get();
            ctx.scope.assertActive();
            return duckDbToolbox.execute(id, { ...input, runtime: active });
          });
        },
      });
    },
  };
}
