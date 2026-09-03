// StyleResolver — paint 表达式/烘焙字段 → 每 shape 样式 LUT 与填充桶。
// 缓存键 (表达式指纹, dataset 引用, attributeVersion, layerId)；
// editVersion 不在键中（顶点级编辑不影响样式）。桶构建立在主线程。

import { EMAP_THEME_COLORS } from '../theme/colors';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { FillLayerPaint } from './layer';
import {
  compileStyleExpression,
  isStyleExpression,
  type CompiledExpression,
  type StyleExpression,
} from './style-expression';

export interface ResolvedFillStyle {
  color: string;
}

export interface StyleResolution {
  styleIds: Uint32Array;
  styles: readonly ResolvedFillStyle[];
  fillBuckets: Uint32Array[];
}

interface CacheEntry {
  fingerprint: string;
  dataset: MapshaperDataset;
  attributeVersion: number;
  resolution: StyleResolution;
}

/** K 超阈值/重建失败时的诊断回调；map 接线到 EventDispatcher 'warning' 事件。 */
export interface StyleWarn {
  layerId: string;
  buckets?: number;
  error?: unknown;
}

export class StyleResolver {
  private _cache = new Map<string, CacheEntry>();

  constructor(private readonly _opts: { onWarn?: (warn: StyleWarn) => void } = {}) {}

  resolveFill(args: {
    layerId: string;
    paint: FillLayerPaint | undefined;
    styleSource: 'mapshaper' | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): StyleResolution | null {
    const fillSpec = args.paint?.['fill-color'];
    // 逐键回退第 1 级：显式标量 paint 优先——已声明 fill-color 的图层
    // 永远走静态 painter 路径，styleSource 不得劫持（spec §4.2）。
    if (typeof fillSpec === 'string') return null;
    const expr = isStyleExpression(fillSpec) ? fillSpec : null;
    const baked = expr === null && args.styleSource === 'mapshaper';
    if (expr === null && !baked) return null; // 完全未声明：静态默认色

    const fingerprint = JSON.stringify(fillSpec ?? null) + '|' + (args.styleSource ?? '');
    const hit = this._cache.get(args.layerId);
    const attrVersion = args.dataset.attributeVersion ?? 0;
    if (
      hit &&
      hit.dataset === args.dataset &&
      hit.attributeVersion === attrVersion &&
      hit.fingerprint === fingerprint
    ) {
      return hit.resolution;
    }
    try {
      return this._rebuild(args, expr, fingerprint, attrVersion);
    } catch (error) {
      // 重建失败：保留旧缓存 stale 渲染 + warn，不出现空白帧（spec §6）。
      this._opts.onWarn?.({ layerId: args.layerId, error });
      return hit?.resolution ?? null;
    }
  }

  private _rebuild(
    args: Parameters<StyleResolver['resolveFill']>[0],
    expr: StyleExpression | null,
    fingerprint: string,
    attrVersion: number,
  ): StyleResolution {
    const records = args.layer.data?.getRecords?.() ?? [];
    const shapes = args.layer.shapes ?? [];
    const compiled: CompiledExpression | null = expr ? compileStyleExpression(expr) : null;

    const styles: ResolvedFillStyle[] = [];
    const styleIndex = new Map<string, number>();
    const nullColor = EMAP_THEME_COLORS.muted;
    const styleIds = new Uint32Array(shapes.length);

    for (let i = 0; i < shapes.length; i++) {
      let value: unknown = null;
      try {
        if (compiled) value = compiled(records[i]);
        else value = records[i]?.['fill'];
      } catch {
        value = null; // 渲染期隔离：单条异常 → null 桶
      }
      const color = typeof value === 'string' && value.length > 0 ? value : nullColor;
      let idx = styleIndex.get(color);
      if (idx === undefined) {
        idx = styles.length;
        styleIndex.set(color, idx);
        styles.push({ color });
      }
      styleIds[i] = idx;
    }

    if (styles.length > 256) {
      this._opts.onWarn?.({ layerId: args.layerId, buckets: styles.length });
    }
    const bucketLists: number[][] = styles.map(() => []);
    for (let i = 0; i < styleIds.length; i++) bucketLists[styleIds[i]].push(i);
    const resolution: StyleResolution = {
      styleIds,
      styles,
      fillBuckets: bucketLists.map((list) => Uint32Array.from(list)),
    };
    this._cache.set(args.layerId, {
      fingerprint,
      dataset: args.dataset,
      attributeVersion: attrVersion,
      resolution,
    });
    return resolution;
  }
}
