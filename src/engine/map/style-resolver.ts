// StyleResolver — paint 表达式/烘焙字段 → 样式表与填充桶。
// 缓存键 (表达式指纹, dataset 引用, attributeVersion, layerId)；
// editVersion 不在键中（顶点级编辑不影响样式）。桶构建立在主线程。

import { EMAP_THEME_COLORS } from '../../ui/theme/colors';
import type {
  LineDashStyle,
  MapshaperDataset,
  MapshaperLayer,
  PointMarkerShape,
} from '../../shared/types/mapshaper-types';
import {
  DEFAULT_LAYER_COLOR,
  type CirclePaint,
  type FillLayerPaint,
  type LinePaint,
} from './layer';
import {
  compileStyleExpression,
  isStyleExpression,
  type CompiledExpression,
  type StyleExpression,
} from './style-expression';

export interface StyleExtras {
  dashType?: LineDashStyle;
  shape?: PointMarkerShape;
}

export interface StyleResolution {
  styles: readonly string[];
  buckets: Uint32Array[];
  /** Per-bucket non-color overrides; set only when a non-color paint expression is active. */
  extras?: readonly StyleExtras[];
}

const LINE_DASH_STYLES: Record<string, true> = {
  solid: true,
  dash: true,
  dot: true,
  'dash-dot': true,
  'arrow-dot': true,
};
const POINT_MARKER_SHAPES: Record<string, true> = {
  circle: true,
  square: true,
  triangle: true,
  'triangle-down': true,
  diamond: true,
  pentagon: true,
  star: true,
  cross: true,
  x: true,
  hexagon: true,
  octagon: true,
};

interface ExtraExpression {
  value: unknown;
  key: keyof StyleExtras;
  valid: Record<string, true>;
  compiled?: CompiledExpression;
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
    return this._resolveColor(args, args.paint?.['fill-color'], 'fill');
  }

  resolveLine(args: {
    layerId: string;
    paint: LinePaint | undefined;
    styleSource: 'mapshaper' | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): StyleResolution | null {
    return this._resolveColor(args, args.paint?.['line-color'], 'stroke', [
      { value: args.paint?.['line-dashstyle'], key: 'dashType', valid: LINE_DASH_STYLES },
    ]);
  }

  resolveCircle(args: {
    layerId: string;
    paint: CirclePaint | undefined;
    styleSource: 'mapshaper' | undefined;
    dataset: MapshaperDataset;
    layer: MapshaperLayer;
  }): StyleResolution | null {
    return this._resolveColor(args, args.paint?.['circle-color'], 'fill', [
      { value: args.paint?.['circle-shape'], key: 'shape', valid: POINT_MARKER_SHAPES },
    ]);
  }

  private _resolveColor(
    args: {
      layerId: string;
      styleSource: 'mapshaper' | undefined;
      dataset: MapshaperDataset;
      layer: MapshaperLayer;
    },
    colorValue: string | StyleExpression | undefined,
    bakedField: 'fill' | 'stroke',
    extras: ExtraExpression[] = [],
  ): StyleResolution | null {
    const activeExtras: ExtraExpression[] = [];
    for (const spec of extras) {
      if (!isStyleExpression(spec.value)) continue;
      try {
        spec.compiled = compileStyleExpression(spec.value);
        activeExtras.push(spec);
      } catch (error) {
        this._opts.onWarn?.({ layerId: args.layerId, error });
      }
    }
    // 逐键回退第 1 级：显式标量 paint 优先。已声明静态颜色且无非颜色
    // 表达式的图层永远走静态 painter 路径，styleSource 不得劫持（spec §4.2）。
    if (typeof colorValue === 'string' && activeExtras.length === 0) return null;
    const expr = isStyleExpression(colorValue) ? colorValue : null;
    const baked = expr === null && args.styleSource === 'mapshaper';
    if (expr === null && !baked && activeExtras.length === 0) return null;

    const fingerprint = `${bakedField}|${JSON.stringify(colorValue ?? null)}|${args.styleSource ?? ''}|${extras
      .map((spec) => JSON.stringify(spec.value ?? null))
      .join('|')}`;
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
      return this._rebuild(
        args,
        expr,
        bakedField,
        baked,
        typeof colorValue === 'string' ? colorValue : null,
        activeExtras,
        fingerprint,
        attrVersion,
      );
    } catch (error) {
      // 重建失败：保留旧缓存 stale 渲染 + warn，不出现空白帧（spec §6）。
      this._opts.onWarn?.({ layerId: args.layerId, error });
      return hit?.resolution ?? null;
    }
  }

  private _rebuild(
    args: {
      layerId: string;
      dataset: MapshaperDataset;
      layer: MapshaperLayer;
    },
    expr: StyleExpression | null,
    bakedField: 'fill' | 'stroke',
    baked: boolean,
    staticColor: string | null,
    activeExtras: ExtraExpression[],
    fingerprint: string,
    attrVersion: number,
  ): StyleResolution {
    const records = args.layer.data?.getRecords?.() ?? [];
    const shapes = args.layer.shapes ?? [];
    const compiled: CompiledExpression | null = expr ? compileStyleExpression(expr) : null;

    const styles: string[] = [];
    const extras: StyleExtras[] = [];
    const styleIndex = new Map<string, number>();
    const nullColor = EMAP_THEME_COLORS.muted;
    const bucketLists: number[][] = [];

    for (let i = 0; i < shapes.length; i++) {
      let value: unknown = staticColor;
      try {
        if (compiled) value = compiled(records[i]);
        else if (baked && staticColor === null) value = records[i]?.[bakedField];
      } catch {
        value = null; // 渲染期隔离：单条异常 → null 桶
      }
      // 颜色回退：表达式/烘焙路径的非法值进 null 桶；无非颜色来源
      // （纯 extras 表达式）时用图层默认色，不劫持烘焙字段。
      const hasColorSource = compiled !== null || baked || staticColor !== null;
      const color =
        typeof value === 'string' && value.length > 0
          ? value
          : hasColorSource
            ? nullColor
            : DEFAULT_LAYER_COLOR;
      // 非颜色表达式：值必须是该键的合法枚举成员，否则省略该键（桶样式
      // 回退到图层静态值），与颜色异常隔离到 null 桶的规则一致。
      let extraValues = '';
      const extra: StyleExtras = {};
      for (const spec of activeExtras) {
        let extraValue: unknown = null;
        try {
          extraValue = spec.compiled!(records[i]);
        } catch {
          extraValue = null;
        }
        // 严格 === true：原型链上的 toString/constructor 等继承属性不得通过校验。
        const validValue =
          typeof extraValue === 'string' && spec.valid[extraValue] === true
            ? extraValue
            : undefined;
        extraValues += `|${validValue ?? ''}`;
        if (validValue !== undefined) {
          if (spec.key === 'dashType') extra.dashType = validValue as LineDashStyle;
          else extra.shape = validValue as PointMarkerShape;
        }
      }
      const key = activeExtras.length > 0 ? color + extraValues : color;
      let idx = styleIndex.get(key);
      if (idx === undefined) {
        idx = styles.length;
        styleIndex.set(key, idx);
        styles.push(color);
        extras.push(extra);
      }
      (bucketLists[idx] ??= []).push(i);
    }

    if (styles.length > 256) {
      this._opts.onWarn?.({ layerId: args.layerId, buckets: styles.length });
    }
    const resolution: StyleResolution = {
      styles,
      buckets: bucketLists.map((list) => Uint32Array.from(list)),
      ...(activeExtras.length > 0 ? { extras } : {}),
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
