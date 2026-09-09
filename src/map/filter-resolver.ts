// filter-resolver — 图层显示过滤器的表达式求值与掩码缓存。
// 仿 StyleResolver：缓存键 (layerId, 表达式指纹, dataset 引用, attributeVersion, editVersion)，
// 值为 feature id → 0/1 的 Uint8Array 位掩码。布尔契约：任一要素求值出非 boolean →
// 本次求值作废、过滤器视为未激活（返回 null = 显示全量）并经 onError 报告一次。

import { compileStyleExpression, type StyleExpression } from './style-expression';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';

export class FilterEvaluationError extends Error {
  override readonly name = 'FilterEvaluationError';
  constructor(
    message: string,
    readonly valueType: string,
  ) {
    super(message);
  }
}

export interface FilterError {
  layerId: string;
  error: Error;
  expression: StyleExpression;
}

interface CacheEntry {
  fingerprint: string;
  dataset: MapshaperDataset;
  attributeVersion: number;
  editVersion: number;
  /** null = 过滤器未激活（求值失败回退）。 */
  mask: Uint8Array | null;
}

export class FilterResolver {
  private _cache = new Map<string, CacheEntry>();

  constructor(private readonly _opts: { onError?: (e: FilterError) => void } = {}) {}

  mask(args: {
    layerId: string;
    filter: StyleExpression | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): Uint8Array | null {
    if (!args.filter) return null;
    const fingerprint = JSON.stringify(args.filter);
    const attributeVersion = args.dataset.attributeVersion ?? 0;
    const editVersion = args.dataset.editVersion ?? 0;
    const hit = this._cache.get(args.layerId);
    if (
      hit &&
      hit.dataset === args.dataset &&
      hit.fingerprint === fingerprint &&
      hit.attributeVersion === attributeVersion &&
      hit.editVersion === editVersion
    ) {
      return hit.mask;
    }
    let mask: Uint8Array | null;
    try {
      mask = this._evaluate(args.filter, args.layer);
    } catch (error) {
      this._opts.onError?.({
        layerId: args.layerId,
        error: error as Error,
        expression: args.filter,
      });
      mask = null;
    }
    this._cache.set(args.layerId, {
      fingerprint,
      dataset: args.dataset,
      attributeVersion,
      editVersion,
      mask,
    });
    return mask;
  }

  private _evaluate(filter: StyleExpression, layer: MapshaperLayer): Uint8Array {
    const compiled = compileStyleExpression(filter);
    const records = layer.data?.getRecords?.() ?? [];
    const n = layer.shapes?.length ?? records.length;
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const value = compiled(records[i]);
      if (typeof value !== 'boolean') {
        const valueType = value === null ? 'null' : typeof value;
        throw new FilterEvaluationError(
          `feature ${i}: filter must evaluate to a boolean, got ${valueType}`,
          valueType,
        );
      }
      mask[i] = value ? 1 : 0;
    }
    return mask;
  }

  clear(layerId?: string): void {
    if (layerId === undefined) this._cache.clear();
    else this._cache.delete(layerId);
  }
}

/** 掩码 × 空间候选：有候选则求交集，无候选（全图渲染）则由掩码合成 id 列表。 */
export function applyMaskToCandidates(
  candidates: Uint32Array | null,
  mask: Uint8Array,
): Uint32Array {
  if (candidates) return candidates.filter((id) => mask[id] === 1);
  const out: number[] = [];
  for (let i = 0; i < mask.length; i++) if (mask[i] === 1) out.push(i);
  return Uint32Array.from(out);
}
