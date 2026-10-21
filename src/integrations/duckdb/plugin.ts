import { pluginSignal } from '../../runtime/context/cancellation';
import type { Plugin } from 'cordis';
import type { DuckDbToolExecutionContext } from './core/tool-definition';
import type { MapshaperDataset } from '../../shared/types/mapshaper-types';
import { DuckDbRuntimeScope, type DuckDbRuntimeOptions } from './runtime-scope';
import { duckDbToolbox } from './toolbox';
export interface DuckDbProcessing {
  execute(
    id: string,
    context: Omit<DuckDbToolExecutionContext, 'runtime'>,
  ): Promise<MapshaperDataset>;
}
/** Supplies one lazy DuckDB runtime. No global setter or eager WASM initialization. */
export function duckDbPlugin(options: DuckDbRuntimeOptions = {}): Plugin.Object {
  return {
    name: 'provider.duckdb',
    provide: ['duckDb', 'duckDbProcessing'],
    apply(ctx) {
      const signal = pluginSignal(ctx);
      ctx.effect(function* () {
        const runtime = new DuckDbRuntimeScope(options);
        yield ctx.effect(() => () => runtime.dispose());
        yield ctx.provide('duckDb', runtime);
        yield ctx.provide('duckDbProcessing', {
          async execute(id, input) {
            const operationSignal = input.signal ? AbortSignal.any([signal, input.signal]) : signal;
            operationSignal.throwIfAborted();
            const active = await runtime.get();
            operationSignal.throwIfAborted();
            const result = await duckDbToolbox.execute(id, {
              ...input,
              runtime: active,
              signal: operationSignal,
            });
            operationSignal.throwIfAborted();
            return result;
          },
        });
      });
    },
  };
}

/** Native Cordis service contracts; no emap-specific service container. */
declare module 'cordis' {
  interface Context {
    duckDb: Pick<DuckDbRuntimeScope, 'get' | 'peek'>;
    duckDbProcessing: DuckDbProcessing;
  }
}
