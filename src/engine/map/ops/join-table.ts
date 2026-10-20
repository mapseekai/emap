// joinTable — join attribute records from a CSV / JSON / another-layer
// source onto a target layer via mapshaper's `-join`. The canonical
// "thematic shapefile + CSV of measures → choropleth" workflow.
//
// `data` is one of:
//   - `{ csv: string | Uint8Array }`  — CSV bytes, injected into the
//                                       runner's input cache as
//                                       `.emap-join.csv`.
//   - `{ json: string | Uint8Array | unknown[] | object }` — JSON
//                                       bytes injected as `.emap-join.json`.
//                                       Arrays/objects are stringified.
//   - `{ layer: string }`             — by-name reference to another
//                                       layer in the same source. No
//                                       cache injection.

import { resolveLayerInList } from '../layer-registry';
import { Err, type OpResult } from '../op-result';
import type { JoinTableOptions } from '../types';
import type { OpContext } from './_context';
import { validateFieldList } from './_fields';

export async function joinTable(ctx: OpContext, opts: JoinTableOptions): Promise<OpResult> {
  const source = ctx.host._sources.get(opts.source);
  if (!source) return Err.notFound('source', opts.source);
  const dataset = source.getDataset();
  if (!dataset) return Err.notFound('source', opts.source);
  if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
  if (!Array.isArray(opts.keys) || opts.keys.length !== 2) {
    return Err.validation('keys', 'must be a 2-element [targetKey, sourceKey] array');
  }
  const [targetKey, sourceKey] = opts.keys.map((k) => (typeof k === 'string' ? k.trim() : ''));
  if (targetKey.length === 0 || sourceKey.length === 0) {
    return Err.validation('keys', 'both keys must be non-empty strings');
  }
  // mapshaper serializes `keys=` as `target,source`; a key containing `,`
  // would split into 3+ keys and trip mapshaper's length validator.
  if (targetKey.includes(',') || sourceKey.includes(',')) {
    return Err.validation('keys', 'keys must not contain `,`');
  }

  let joinSource: string;
  let inputFiles: Record<string, Uint8Array | string> | undefined;
  const data = opts.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== 'object') {
    return Err.validation('data', 'must be { csv } | { json } | { layer }');
  }

  if ('layer' in data && typeof data.layer === 'string' && data.layer.trim().length > 0) {
    joinSource = data.layer.trim();
  } else if ('csv' in data && (typeof data.csv === 'string' || data.csv instanceof Uint8Array)) {
    const filename = '.emap-join.csv';
    joinSource = filename;
    inputFiles = { [filename]: data.csv as string | Uint8Array };
  } else if ('json' in data && data.json !== undefined) {
    const filename = '.emap-join.json';
    let payload: string | Uint8Array;
    if (typeof data.json === 'string' || data.json instanceof Uint8Array) {
      payload = data.json as string | Uint8Array;
    } else {
      payload = JSON.stringify(data.json);
    }
    joinSource = filename;
    inputFiles = { [filename]: payload };
  } else {
    return Err.validation('data', 'must contain one of `csv`, `json`, or `layer`');
  }
  if (!ctx.host._allowExpressionEvaluation([opts.where, opts.calc], 'joinTable')) {
    return Err.expressionDisabled('joinTable');
  }

  const joinOpts: Record<string, unknown> = {
    source: joinSource,
    keys: [targetKey, sourceKey],
  };
  const fields = validateFieldList('fields', opts.fields);
  if (!fields.ok) return fields;
  if (fields.value.length > 0) joinOpts.fields = fields.value;
  if (opts.prefix && opts.prefix.length > 0) joinOpts.prefix = opts.prefix;
  if (opts.where && opts.where.trim().length > 0) joinOpts.where = opts.where;
  if (opts.calc && opts.calc.trim().length > 0) joinOpts.calc = opts.calc;
  if (opts.unjoined) joinOpts.unjoined = true;
  if (opts.unmatched) joinOpts.unmatched = true;

  return ctx.runDatasetCommandParsed(
    opts.source,
    [
      { name: 'target', options: { target: opts.target } },
      { name: 'join', options: joinOpts },
    ],
    `Join ${opts.target}`,
    inputFiles,
  );
}
