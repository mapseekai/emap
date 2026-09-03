// classifyFeatures — 属性分级烘焙。断点/类别与计数在 emap 侧计算（权威），
// mapshaper -classify 只收显式 breaks/categories/colors 做逐记录字段写入。
// null/other 始终传 effective 色并回显（见 spec §4.1）。

import type { ParsedCommand } from '../../adapter/mapshaper-adapter';
import { EMAP_THEME_COLORS } from '../../theme/colors';
import { bumpAttributeVersion } from '../../types/mapshaper-types';
import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { ClassificationResult, ClassifyFeaturesOptions } from '../types';
import type { OpContext } from './_context';
import {
  equalIntervalBreaks,
  niceBreaks,
  quantileBreaks,
  summarizeCategorical,
  summarizeSequential,
} from './_classify-breaks';

export async function classifyFeatures(
  ctx: OpContext,
  opts: ClassifyFeaturesOptions,
): Promise<OpResult<ClassificationResult>> {
  const source = ctx.host._sources.get(opts.source);
  const dataset = source?.getDataset?.();
  if (!source || !dataset) return Err.notFound('source', opts.source);
  const layer = resolveLayerInList(dataset.layers, opts.target);
  if (!layer) return Err.notFound('layer', opts.target);
  const records = layer.data?.getRecords?.() ?? [];
  if (opts.colors.length === 0) return Err.validation('colors', 'at least one color required');

  const values = records.map((r) => r?.[opts.field]);
  if (records.length > 0 && values.every((v) => v === undefined)) {
    return Err.validation('field', `field "${opts.field}" not found`);
  }

  const nullColor = opts.nullValue ?? EMAP_THEME_COLORS.muted;
  const otherColor = opts.otherColor ?? nullColor;
  const saveAs = opts.saveAs ?? 'fill';
  const options: Record<string, unknown> = {
    field: opts.field,
    colors: opts.colors,
    save_as: saveAs,
    null_value: nullColor,
  };
  if (opts.invert) options.invert = true;

  let result: ClassificationResult;

  if (opts.method === 'categorical') {
    const categories =
      opts.categories ??
      ([...new Set(values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)))] as (
        | string
        | number
      )[]);
    if (categories.length !== opts.colors.length) {
      return Err.validation(
        'colors',
        `colors.length must equal categories.length (${categories.length})`,
      );
    }
    const { counts, otherCount, nullCount } = summarizeCategorical(values, categories);
    options.method = 'categorical';
    options.categories = categories;
    options.other = otherColor;
    result = {
      kind: 'categorical',
      categories: [...categories],
      colors: [...opts.colors],
      counts,
      otherColor,
      otherCount,
      nullColor,
      nullCount,
      saveAs,
      featureCount: records.length,
    };
  } else {
    const numeric = values.filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
    if (numeric.length === 0) {
      return Err.validation('field', `field "${opts.field}" has no numeric values`);
    }
    const nullish = values.filter(
      (v) => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)),
    ).length;
    if (numeric.length !== values.length - nullish) {
      return Err.validation('field', `field "${opts.field}" is not numeric`);
    }
    const classes = opts.classes ?? 4;
    if (opts.breaks === undefined && (!Number.isInteger(classes) || classes < 2)) {
      return Err.validation('classes', 'classes must be an integer >= 2');
    }
    const sorted = [...numeric].sort((a, b) => a - b);
    const breaks =
      opts.breaks ??
      (opts.method === 'quantile'
        ? quantileBreaks(sorted, classes)
        : opts.method === 'nice'
          ? niceBreaks(sorted[0], sorted[sorted.length - 1], classes)
          : equalIntervalBreaks(sorted[0], sorted[sorted.length - 1], classes));
    if (opts.colors.length !== breaks.length + 1) {
      return Err.validation(
        'colors',
        `colors.length must equal breaks.length + 1 (${breaks.length + 1})`,
      );
    }
    const { counts, nullCount } = summarizeSequential(values, breaks);
    options.breaks = breaks;
    result = {
      kind: 'sequential',
      method: opts.method,
      breaks,
      colors: [...opts.colors],
      counts,
      nullColor,
      nullCount,
      saveAs,
      featureCount: records.length,
    };
  }

  const commands: ParsedCommand[] = [
    { name: 'target', options: { target: opts.target } },
    { name: 'classify', options },
  ];
  const ran = await ctx.runDatasetCommandParsed(
    opts.source,
    commands,
    `Classify ${opts.target} by ${opts.field}`,
  );
  if (!ran.ok) return ran as OpResult<never>;
  // 主线程路径就地改 records；bump 使样式缓存失效（worker 替换路径由引用兜底）。
  bumpAttributeVersion(ctx.host._sources.get(opts.source)?.getDataset?.());
  return { ok: true, value: result };
}
