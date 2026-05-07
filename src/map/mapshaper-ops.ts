// Mapshaper command wrappers. Extracted from map.ts so the orchestrator
// stays focused on render / lifecycle. Composed onto Emap as
// `emap.ops`; the manager calls back into a small surface of internal
// helpers (`layers.resolve`, `_history`, `_workerPool`, ...) on the host.

import mapshaper from 'mapshaper';
import { DatasetReplaceCommand } from '../edit/commands/dataset-replace';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
import type { EmapHostInternal } from './emap-host';
import { resolveLayerInList } from './layer-registry';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';
import { quoteCliArg } from './command-args';
import { Err, OK, okValue, type OpResult } from './op-result';
import type {
  ApplyExpressionOptions,
  BufferOptions,
  CleanOptions,
  CheckGeometryOptions,
  ClipEraseOptions,
  DivideOptions,
  DropLayerOptions,
  DissolveOptions,
  ExplodeOptions,
  FilterFieldsOptions,
  FilterOptions,
  GeometryCheckReport,
  InnerlinesOptions,
  IntersectionPointsLayerOptions,
  JoinTableOptions,
  LinesOptions,
  MergeLayersOptions,
  MosaicOptions,
  PointsOptions,
  PolygonsOptions,
  ProjectOptions,
  RebuildTopologyOptions,
  RenameFieldsOptions,
  RenameLayerOptions,
  SimplifyOptions,
  SnapOptions,
  SortFeaturesOptions,
  SplitLayerOptions,
  UniqueFeaturesOptions,
  UnionOptions,
} from './types';

/**
 * Mapshaper command manager. Owned by Emap and exposed as `emap.ops`.
 * Wraps mapshaper's `-clip`, `-dissolve`, `-buffer`, ... commands and
 * routes them through the optional worker pool.
 */
export class MapshaperOps {
  constructor(private _emap: EmapHostInternal) {}

  async clipLayer(opts: ClipEraseOptions): Promise<OpResult> {
    return this._runClipErase(opts, 'clip');
  }

  /**
   * Erase (cut holes from) a layer using a polygon mask layer via mapshaper's
   * `-erase` pipeline. Same semantics as {@link clipLayer}.
   */
  async eraseLayer(opts: ClipEraseOptions): Promise<OpResult> {
    return this._runClipErase(opts, 'erase');
  }

  async _runClipErase(opts: ClipEraseOptions, op: 'clip' | 'erase'): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    // Validate that both target and mask resolve to layers in this source's
    // dataset. mapshaper would throw an opaque error otherwise.
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!resolveLayerInList(dataset.layers, opts.mask)) return Err.notFound('mask', opts.mask);

    const verb = op === 'clip' ? 'Clip' : 'Erase';
    const cmd = `-target ${quoteCliArg(opts.target)} -${op} source=${quoteCliArg(opts.mask)}`;
    return this._runDatasetCommand(opts.source, cmd, `${verb} ${opts.target}`);
  }

  /**
   * Merge polygon (or point / polyline) features in the target layer using
   * mapshaper's `-dissolve` pipeline. Without `field`, all features in the
   * layer collapse into one; with `field`, features sharing the same field
   * value are merged. Returns `true` on success, `false` for unresolvable
   * source / target. Recorded as a single undoable history entry.
   */
  async dissolveLayer(opts: DissolveOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

    // `field` (single) and `fields` (multi) are mutually exclusive — both
    // set is a configuration error.
    const hasFields = Array.isArray(opts.fields) && opts.fields.length > 0;
    if (opts.field !== undefined && hasFields) {
      return Err.validation('field', '`field` and `fields` are mutually exclusive');
    }

    // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
    // strings). A field name containing `,` would silently group by N
    // imaginary fields; reject up-front instead.
    if (opts.field !== undefined && (typeof opts.field !== 'string' || opts.field.includes(','))) {
      return Err.validation('field', 'field name must be a string without `,`');
    }
    if (!this._emap._allowExpressionEvaluation([opts.calc, opts.where], 'dissolveLayer')) {
      return Err.expressionDisabled('dissolveLayer');
    }

    // Build the positional group-by token (single-field convenience or
    // multi-field array). When neither is set, dissolve collapses every
    // feature into one (mapshaper's default for -dissolve with no key).
    let groupToken = '';
    if (opts.field) {
      groupToken = ` ${quoteCliArg(opts.field)}`;
    } else if (hasFields) {
      const safeFields = opts.fields!.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safeFields.length > 0) {
        groupToken = ` ${quoteCliArg(safeFields.join(','))}`;
      }
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-dissolve${groupToken}`,
    ];

    const safeFieldList = (list?: string[]) =>
      Array.isArray(list)
        ? list.filter((f) => typeof f === 'string' && !f.includes(','))
        : [];

    const sumFields = safeFieldList(opts.sumFields);
    if (sumFields.length > 0) parts.push(`sum-fields=${sumFields.join(',')}`);

    const copyFields = safeFieldList(opts.copyFields);
    if (copyFields.length > 0) parts.push(`copy-fields=${copyFields.join(',')}`);

    if (opts.calc && opts.calc.trim()) {
      parts.push(`calc=${quoteCliArg(opts.calc)}`);
    }
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteCliArg(opts.where)}`);
    }
    if (opts.multipart) parts.push('multipart');
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');

    return this._runDatasetCommand(opts.source, parts.join(' '), `Dissolve ${opts.target}`);
  }

  /**
   * Generate buffer polygons for a layer using mapshaper's `-buffer` pipeline.
   *
   * `radius` is interpreted in source-CRS units: degrees for EPSG:4326,
   * metres for typical projected CRSes. Accepts either a constant number or a
   * mapshaper expression string evaluated per record (e.g. `"pop / 1000"`),
   * matching mapshaper CLI syntax exactly.
   *
   * Returns `true` on success, `false` for unresolvable source/target.
   * Recorded as a single undoable history entry; inherits dataset-replace
   * semantics (history barrier, selection cleared) from `_runDatasetCommand`.
   */
  async bufferLayer(opts: BufferOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

    // Validate numeric radius up-front: 0 silently produces empty buffers,
    // negative values throw inside mapshaper. Expression-string radii are
    // forwarded as-is — mapshaper evaluates per-feature and there's no
    // sound way to validate them without parsing JS.
    if (typeof opts.radius === 'number') {
      if (!Number.isFinite(opts.radius) || opts.radius <= 0) {
        return Err.validation('radius', 'must be a positive finite number');
      }
    } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
      return Err.validation('radius', 'must be a positive number or non-empty expression');
    }
    if (typeof opts.radius === 'string' && !this._emap._allowExpressionEvaluation([opts.radius], 'bufferLayer')) {
      return Err.expressionDisabled('bufferLayer');
    }

    // Numbers go in bare; expression strings are quoted so the shell-style
    // command parser keeps them intact.
    const radiusArg =
      typeof opts.radius === 'number' ? String(opts.radius) : quoteCliArg(opts.radius);
    const capArg = opts.capStyle ? ` cap-style=${opts.capStyle}` : '';
    const cmd = `-target ${quoteCliArg(opts.target)} -buffer ${radiusArg}${capArg}`;
    return this._runDatasetCommand(opts.source, cmd, `Buffer ${opts.target}`);
  }

  /**
   * Run a mapshaper `-each` JS expression against a layer to update
   * attributes in bulk. Use for derived fields (`this.density = this.pop /
   * this.area`), normalization (`this.name = this.name.toUpperCase()`), or
   * any other per-record mutation that the per-feature
   * {@link setFeatureProperty} would be tedious for.
   *
   * The optional `where` filter mirrors mapshaper CLI's `-each EXPR
   * where=...` — only records matching it are mutated.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   * Recorded as one undoable history entry; inherits dataset-replace
   * semantics (history barrier, selection cleared) from `_runDatasetCommand`.
   */
  async applyExpression(opts: ApplyExpressionOptions): Promise<OpResult> {
    if (!opts.expression || !opts.expression.trim()) {
      return Err.validation('expression', 'must be a non-empty expression');
    }
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!this._emap._allowExpressionEvaluation([opts.expression, opts.where], 'applyExpression')) {
      return Err.expressionDisabled('applyExpression');
    }

    const whereArg = opts.where && opts.where.trim()
      ? ` where=${quoteCliArg(opts.where)}`
      : '';
    const cmd = `-target ${quoteCliArg(opts.target)} -each ${quoteCliArg(opts.expression)}${whereArg}`;
    return this._runDatasetCommand(opts.source, cmd, `Update ${opts.target}`);
  }

  /**
   * Divide multi-part features in the target layer into single-part features
   * via mapshaper's `-explode`. Each part inherits the original record's
   * attributes. Returns `false` for unresolvable source / target.
   *
   * Useful for unpacking multipolygon islands, multipart polylines, or
   * multipoint clusters into separately-pickable features.
   */
  async explodeLayer(opts: ExplodeOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const cmd = `-target ${quoteCliArg(opts.target)} -explode`;
    return this._runDatasetCommand(opts.source, cmd, `Explode ${opts.target}`);
  }

  /**
   * Convert a polygon layer to a polyline layer along shared polygon edges
   * via mapshaper's `-innerlines`. Useful for cartographic styling: render
   * internal administrative borders as a separately-stylable line layer
   * while keeping the original polygons.
   *
   * Optional `where` (with `A` / `B` in scope) keeps only boundaries whose
   * neighbouring polygons match the predicate; `name` controls the output
   * layer name; `noReplace: true` keeps the input polygon layer alongside
   * the new polyline layer.
   */
  async innerlinesLayer(opts: InnerlinesOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!this._emap._allowExpressionEvaluation([opts.where], 'innerlinesLayer')) {
      return Err.expressionDisabled('innerlinesLayer');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-innerlines`,
    ];
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteCliArg(opts.where)}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Innerlines ${opts.target}`);
  }

  /**
   * Drop features from a layer using mapshaper's `-filter`.
   *
   * Convention follows mapshaper: features whose `expression` evaluates to
   * FALSE are deleted (so `'this.pop > 100'` *keeps* populous features).
   * `invert: true` flips the predicate. `removeEmpty: true` also drops
   * features with null geometry.
   *
   * Returns `false` when neither `expression` nor `removeEmpty` is supplied
   * (mapshaper would error otherwise). Companion to {@link applyExpression}:
   * same JS context, opposite intent (mutate vs delete).
   */
  async filterFeatures(opts: FilterOptions): Promise<OpResult> {
    const hasExpr = !!(opts.expression && opts.expression.trim());
    if (!hasExpr && !opts.removeEmpty) {
      return Err.validation('expression', 'must supply `expression` or `removeEmpty: true`');
    }

    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!this._emap._allowExpressionEvaluation([opts.expression], 'filterFeatures')) {
      return Err.expressionDisabled('filterFeatures');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-filter`,
    ];
    if (hasExpr) {
      parts.push(quoteCliArg(opts.expression as string));
    }
    if (opts.invert) {
      parts.push('invert');
    }
    if (opts.removeEmpty) {
      parts.push('remove-empty');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Filter ${opts.target}`);
  }

  /**
   * Snap nearby vertices together using mapshaper's `-snap`. Useful as a
   * targeted fix for almost-but-not-quite-coincident vertices left over
   * from reprojection, manual digitization, or merged sources.
   *
   * `interval` is the snap distance in source-CRS units; mapshaper picks a
   * small default when omitted. `endpoints: true` restricts to line
   * endpoints. `precision` rounds all coords to a given decimal precision.
   */
  async snapLayer(opts: SnapOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-snap`,
    ];
    if (typeof opts.interval === 'number') {
      parts.push(String(opts.interval));
    }
    if (opts.endpoints) {
      parts.push('endpoints');
    }
    if (typeof opts.precision === 'number') {
      parts.push(`precision=${opts.precision}`);
    }
    if (opts.fixGeometry) {
      parts.push('fix-geometry');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Snap ${opts.target}`);
  }

  /**
   * Run mapshaper's `-clean` against a layer to repair topology issues
   * (intersection cuts, polygon overlaps, sliver removal). Heavy — O(N²) on
   * polygon counts in the worst case — so it is opt-in instead of running on
   * every import. Returns `Promise<OpResult>`; failure modes match the other
   * dataset-replace ops (`Err.notFound` / `Err.validation` for input shape
   * problems, `Err.mapshaper` if mapshaper threw mid-pipeline).
   *
   * All tuning options are optional; omitting them lets mapshaper apply its
   * default cleanup heuristics. See {@link CleanOptions} for the surface.
   */
  async cleanLayer(opts: CleanOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);

    // Numeric tuning options reject NaN / negative — mapshaper would either
    // error opaquely or silently produce surprising results.
    const validNumOrUnset = (n?: number) =>
      n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
    if (!validNumOrUnset(opts.gapFillArea)) return Err.validation('gapFillArea', 'must be a finite non-negative number');
    if (!validNumOrUnset(opts.sliverControl)) return Err.validation('sliverControl', 'must be a finite non-negative number');
    if (!validNumOrUnset(opts.snapInterval)) return Err.validation('snapInterval', 'must be a finite non-negative number');

    if (opts.overlapRule !== undefined) {
      const allowed = ['min-id', 'max-id', 'min-area', 'max-area'];
      if (!allowed.includes(opts.overlapRule)) {
        return Err.validation('overlapRule', `must be one of ${allowed.join(', ')}`);
      }
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-clean`,
    ];
    if (opts.gapFillArea !== undefined) parts.push(`gap-fill-area=${opts.gapFillArea}`);
    if (opts.sliverControl !== undefined) parts.push(`sliver-control=${opts.sliverControl}`);
    if (opts.snapInterval !== undefined) parts.push(`snap-interval=${opts.snapInterval}`);
    if (opts.noSnap) parts.push('no-snap');
    if (opts.allowOverlaps) parts.push('allow-overlaps');
    if (opts.overlapRule !== undefined) parts.push(`overlap-rule=${opts.overlapRule}`);
    if (opts.allowEmpty) parts.push('allow-empty');
    if (opts.rewind) parts.push('rewind');
    if (opts.onlyArcs) parts.push('only-arcs');
    if (opts.noArcDissolve) parts.push('no-arc-dissolve');

    return this._runDatasetCommand(opts.source, parts.join(' '), `Clean ${opts.target}`);
  }

  /**
   * Re-derive shared arcs and insert intersection cuts via mapshaper's
   * `addIntersectionCuts` — the lightweight repair pass every overlay
   * command runs as a pre-pass before clip / erase / dissolve / union.
   *
   * Use case: after `translateSelected` / `rotateSelected` / vertex moves
   * change arc geometry, this pass re-detects overlaps that the in-place
   * edits didn't update. Without it, exports bake topology bugs into
   * output and shared-arc rendering can misrepresent neighbour boundaries.
   *
   * Lighter than {@link cleanLayer} (which also removes spikes / slivers
   * and dissolves polygon overlaps).
   *
   * Acts as a history barrier — prior fine-grained edit commands close
   * over the OLD `arcs` object and old arc indices, so undoing them after
   * a rebuild would corrupt geometry. The rebuild itself is one undoable
   * step that fully restores the pre-rebuild state.
   *
   * Returns `true` (no-op) for arc-less point-only datasets,
   * `false` for unresolvable source or `addIntersectionCuts` errors.
   */
  async rebuildTopology(opts: RebuildTopologyOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', opts.source);
    if (!original.arcs) return OK; // point-only — nothing to rebuild

    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);
    const after: MapshaperDataset = mapshaper.internal.copyDataset(original);

    try {
      mapshaper.internal.addIntersectionCuts(after, {
        snap_interval: opts.snapInterval,
        no_snap: opts.noSnap,
        rebuild_topology: opts.rebuildTopology,
      });
    } catch (err) {
      this._emap.fire('error', { error: err });
      return Err.mapshaper(err, { operation: 'rebuildTopology' });
    }

    source.setDataset(after);

    this._emap._history.clear();
    this._emap._history.push(new DatasetReplaceCommand({ source, before, after, label: 'Rebuild topology' }));
    this._emap._fireHistoryChange();

    this._emap._fireSelectionChange(this._emap._selection.clear());

    this._emap._scheduleRender();
    return OK;
  }

  /**
   * Flatten overlapping polygons in a single layer into a tile mosaic via
   * mapshaper's `-mosaic`. Every overlap region becomes its own polygon;
   * gaps are preserved.
   *
   * Returns `false` for unresolvable source / target. Inherits all
   * dataset-replace semantics from `_runDatasetCommand`.
   */
  async mosaicLayer(opts: MosaicOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!this._emap._allowExpressionEvaluation([opts.calc], 'mosaicLayer')) {
      return Err.expressionDisabled('mosaicLayer');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-mosaic`,
    ];
    if (typeof opts.snapInterval === 'number') {
      parts.push(`snap-interval=${opts.snapInterval}`);
    }
    if (opts.noSnap) {
      parts.push('no-snap');
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.calc && opts.calc.trim()) {
      parts.push(`calc=${quoteCliArg(opts.calc)}`);
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Mosaic ${opts.target}`);
  }

  /**
   * Overlay two or more polygon layers from the same source via mapshaper's
   * `-union`. Output is one flat mosaic where every intersection region is
   * its own polygon, attributed by the union of input fields.
   *
   * Returns `false` for unresolvable source, fewer than two targets, or any
   * unresolved target name. Inherits dataset-replace semantics from
   * `_runDatasetCommand`.
   *
   * Note: mapshaper's `-target` for `-union` is a comma-separated layer
   * list, not a single layer name; we join `targets` with commas inside one
   * quoted argument.
   */
  async unionLayers(opts: UnionOptions): Promise<OpResult> {
    if (!opts.targets || opts.targets.length < 2) {
      return Err.validation('targets', 'must supply at least 2 target layers');
    }
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    // Every target must resolve and be `,`-free — mapshaper joins the list
    // with commas and would otherwise silently split a comma-bearing name
    // into multiple bogus targets.
    for (const t of opts.targets) {
      if (typeof t !== 'string' || t.includes(',')) {
        return Err.validation('targets', `target name must not contain ',': ${String(t)}`);
      }
      if (!resolveLayerInList(dataset.layers, t)) return Err.notFound('layer', t);
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteCliArg(targetList)}`,
      `-union`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.noReplace) {
      parts.push('no-replace');
    }
    return this._runDatasetCommand(opts.source, parts.join(' '), `Union ${targetList}`);
  }

  /**
   * Cut a polyline `target` layer at the boundaries of a polygon `divider`
   * layer in the same source via mapshaper's `-divide`. Each resulting line
   * segment inherits the underlying polygon's attributes (subset by `fields`
   * when supplied).
   *
   * Returns `false` for unresolvable source, missing/wrong-geometry target,
   * or missing/wrong-geometry divider. Inherits dataset-replace semantics
   * from `_runDatasetCommand`.
   *
   * mapshaper's `-divide` can take its polygon source positionally, but we
   * use the explicit `source=<name>` form for symmetry with `clipLayer` and
   * `eraseLayer`.
   */
  async divideLayer(opts: DivideOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const targetLayer = resolveLayerInList(dataset.layers, opts.target);
    if (!targetLayer) return Err.notFound('layer', opts.target);
    if (targetLayer.geometry_type !== 'polyline') {
      return Err.validation('target', `expected polyline layer, got ${targetLayer.geometry_type ?? 'unknown'}`);
    }
    const dividerLayer = resolveLayerInList(dataset.layers, opts.divider);
    if (!dividerLayer) return Err.notFound('divider', opts.divider);
    if (dividerLayer.geometry_type !== 'polygon') {
      return Err.validation('divider', `expected polygon layer, got ${dividerLayer.geometry_type ?? 'unknown'}`);
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-divide source=${quoteCliArg(opts.divider)}`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.force) parts.push('force');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Divide ${opts.target}`);
  }

  /**
   * Extract a point layer from a polygon or polyline target via mapshaper's
   * `-points`. The `type` enum collapses mapshaper's mutually-exclusive
   * `-points` flags into a single option:
   *
   * - `centroid` / `inner` — one point per polygon (target must be polygon)
   * - `midpoints` / `interpolated` — sample along polylines (target must be polyline;
   *   `interpolated` also requires a positive `interval`)
   * - `vertices` / `endpoints` — extract path vertices (target must be polygon or polyline)
   *
   * Returns `false` for unresolvable source / target, mismatched geometry,
   * or `interpolated` without a positive `interval`. Inherits dataset-replace
   * semantics from `_runDatasetCommand`.
   */
  async pointsLayer(opts: PointsOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const layer = resolveLayerInList(dataset.layers, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);

    const geom = layer.geometry_type;
    switch (opts.type) {
      case 'centroid':
      case 'inner':
        if (geom !== 'polygon') {
          return Err.validation('type', `${opts.type} requires polygon target, got ${geom ?? 'unknown'}`);
        }
        break;
      case 'midpoints':
      case 'interpolated':
        if (geom !== 'polyline') {
          return Err.validation('type', `${opts.type} requires polyline target, got ${geom ?? 'unknown'}`);
        }
        break;
      case 'vertices':
      case 'endpoints':
        if (geom !== 'polygon' && geom !== 'polyline') {
          return Err.validation('type', `${opts.type} requires polygon/polyline target, got ${geom ?? 'unknown'}`);
        }
        break;
      default:
        return Err.validation('type', `unknown type: ${String((opts as PointsOptions).type)}`);
    }
    if (opts.type === 'interpolated' && !(typeof opts.interval === 'number' && opts.interval > 0)) {
      return Err.validation('interval', 'interpolated points require a positive interval');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-points ${opts.type}`,
    ];
    if (opts.type === 'interpolated') {
      parts.push(`interval=${opts.interval}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Points ${opts.target}`);
  }

  /**
   * Convert a polygon target into a polyline layer of its boundary arcs via
   * mapshaper's `-lines`. Optional `fields` produces a hierarchy of
   * boundaries (outer hull at the top, intra-region boundaries below).
   *
   * Returns `false` for unresolvable source / target or non-polygon target.
   * Inherits dataset-replace semantics from `_runDatasetCommand`.
   *
   * `fields` is mapshaper's positional `DEFAULT: true` arg, emitted as a
   * bare comma-joined token (no `fields=` prefix) to match the CLI norm.
   */
  async linesLayer(opts: LinesOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const layer = resolveLayerInList(dataset.layers, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    if (layer.geometry_type !== 'polygon') {
      return Err.validation('target', `expected polygon layer, got ${layer.geometry_type ?? 'unknown'}`);
    }

    // mapshaper's `-lines` DEFAULT positional is the comma-joined fields
    // list. Build the `-lines [fields-csv]` token in one place rather than
    // pushing a placeholder and rewriting it.
    const safeFields = opts.fields?.filter((f) => typeof f === 'string' && !f.includes(','));
    const linesToken = safeFields && safeFields.length > 0
      ? `-lines ${safeFields.join(',')}`
      : '-lines';

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      linesToken,
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Lines ${opts.target}`);
  }

  /**
   * Convert a polyline target into a polygon layer via mapshaper's
   * `-polygons`. Inverse of {@link linesLayer}. The default path snaps
   * gaps and reconstructs faces; `fromRings` skips that step when the
   * input is known to be a layer of closed paths.
   *
   * Returns `false` for unresolvable source / target or non-polyline
   * target. Inherits dataset-replace semantics from `_runDatasetCommand`.
   */
  async polygonsLayer(opts: PolygonsOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    const layer = resolveLayerInList(dataset.layers, opts.target);
    if (!layer) return Err.notFound('layer', opts.target);
    if (layer.geometry_type !== 'polyline') {
      return Err.validation('target', `expected polyline layer, got ${layer.geometry_type ?? 'unknown'}`);
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      '-polygons',
    ];
    if (typeof opts.gapTolerance === 'number' && opts.gapTolerance > 0) {
      parts.push(`gap-tolerance=${opts.gapTolerance}`);
    }
    if (opts.fromRings) parts.push('from-rings');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Polygons ${opts.target}`);
  }

  /**
   * Simplify the geometry of polygon and polyline features via mapshaper's
   * `-simplify`. Operates on the source's shared arcs (sets per-vertex `zz`
   * thresholds + a `zlimit`); subsequent commands and exports honour the
   * threshold automatically. Re-running with a different threshold replaces
   * the previous one — the original vertex data is preserved on the arc
   * collection.
   *
   * Exactly one of `percentage`, `interval`, or `resolution` MUST be
   * supplied. `target` is optional; when omitted, the whole source dataset
   * is simplified (mapshaper CLI default).
   *
   * Returns `false` for unresolvable source, unresolved target, missing /
   * conflicting / out-of-range threshold, or malformed `resolution`.
   */
  async simplifyLayer(opts: SimplifyOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (opts.target !== undefined) {
      if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    }

    // Exactly one threshold mode.
    const thresholdsSet = [
      opts.percentage !== undefined,
      opts.interval !== undefined,
      opts.resolution !== undefined,
    ].filter(Boolean).length;
    if (thresholdsSet !== 1) {
      return Err.validation('threshold', 'must supply exactly one of percentage, interval, resolution');
    }

    let thresholdToken: string;
    if (opts.percentage !== undefined) {
      const p = opts.percentage;
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return Err.validation('percentage', 'must be a finite number in [0, 100]');
      }
      thresholdToken = `${p}%`;
    } else if (opts.interval !== undefined) {
      const v = opts.interval;
      if (!Number.isFinite(v) || v <= 0) {
        return Err.validation('interval', 'must be a positive finite number');
      }
      thresholdToken = `interval=${v}`;
    } else {
      const r = opts.resolution!;
      if (!/^\d+x\d+$/.test(r)) {
        return Err.validation('resolution', 'must match `WIDTHxHEIGHT` (digits)');
      }
      thresholdToken = `resolution=${r}`;
    }

    // `weighting` only makes sense for weighted-Visvalingam. mapshaper
    // silently ignores `weighting` when method is `dp` or `visvalingam`,
    // which leaves the caller wondering why their tuning had no effect.
    // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
    if (opts.weighting !== undefined && opts.method !== undefined && opts.method !== 'weighted') {
      return Err.validation('weighting', `weighting only applies to method='weighted', not ${opts.method}`);
    }

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteCliArg(opts.target)}`);
    parts.push(`-simplify ${thresholdToken}`);
    if (opts.method) parts.push(opts.method);
    if (typeof opts.weighting === 'number' && Number.isFinite(opts.weighting)) {
      parts.push(`weighting=${opts.weighting}`);
    }
    if (opts.planar) parts.push('planar');
    if (opts.keepShapes) parts.push('keep-shapes');
    if (opts.lockBox) parts.push('lock-box');
    if (opts.noRepair) parts.push('no-repair');

    const label = `Simplify ${opts.target ?? opts.source}`;
    return this._runDatasetCommand(opts.source, parts.join(' '), label);
  }

  /**
   * Reproject a source's coordinates via mapshaper's `-proj` (Proj.4).
   * The destination `crs` accepts EPSG codes (`'EPSG:3857'`), aliases
   * (`'webmercator'`, `'robinson'`, `'wgs84'`), or full Proj.4 strings.
   * `target` is optional; when omitted, the whole source dataset is
   * reprojected.
   *
   * Returns `false` for unresolvable source, unresolved target, or
   * empty `crs`. Inherits dataset-replace semantics from `_runDatasetCommand`
   * (history barrier, undoable).
   *
   * Note: the source's stored CRS metadata is updated by mapshaper inside
   * the dataset, but emap does NOT auto-fit the viewport to the new
   * projected extent. Call `setExtent(source.getExtent())` after
   * `await projectLayer(...)` to recentre.
   */
  async projectLayer(opts: ProjectOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (opts.target !== undefined) {
      if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    }
    const crs = (opts.crs ?? '').trim();
    if (crs.length === 0) return Err.validation('crs', 'must be a non-empty CRS string');

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteCliArg(opts.target)}`);
    parts.push(`-proj ${quoteCliArg(crs)}`);
    if (opts.init && opts.init.trim()) {
      parts.push(`init=${quoteCliArg(opts.init)}`);
    }
    if (opts.densify) parts.push('densify');

    const label = `Project ${opts.target ?? opts.source}`;
    return this._runDatasetCommand(opts.source, parts.join(' '), label);
  }

  /**
   * Rename one layer in a source dataset via mapshaper's `-rename-layers`.
   * The new name is trimmed and validated for non-emptiness and absence of
   * collision with any other existing layer in the same dataset.
   *
   * Returns `false` for unresolvable source / target, empty name, or
   * collision with another layer.
   */
  async renameLayer(opts: RenameLayerOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const newName = (opts.name ?? '').trim();
    if (newName.length === 0) return Err.validation('name', 'must be a non-empty string');
    // mapshaper's -rename-layers DEFAULT is `names` (comma-list). A name
    // containing `,` would silently split into N rename pairs.
    if (newName.includes(',')) return Err.validation('name', 'must not contain `,`');
    // Allow renaming to the same name (no-op-ish), but reject if another
    // layer in this dataset already owns it.
    if (newName !== opts.target) {
      const collision = dataset.layers.some(
        (l: any) => (l?.name ?? '') === newName,
      );
      if (collision) return Err.validation('name', `another layer already named '${newName}'`);
    }
    const cmd = `-target ${quoteCliArg(opts.target)} -rename-layers ${quoteCliArg(newName)}`;
    return this._runDatasetCommand(opts.source, cmd, `Rename ${opts.target} → ${newName}`);
  }

  /**
   * Combine two or more layers in the same source into one via mapshaper's
   * `-merge-layers`. Targets are joined with commas inside one quoted
   * `-target` argument (matching mapshaper's CLI grammar for this command).
   *
   * Up-front geometry-type check: if targets disagree and the caller didn't
   * pass `force: true`, returns `false` rather than letting mapshaper throw
   * an opaque mid-pipeline error.
   */
  async mergeLayers(opts: MergeLayersOptions): Promise<OpResult> {
    if (!opts.targets || opts.targets.length < 2) {
      return Err.validation('targets', 'must supply at least 2 target layers');
    }
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);

    // Targets are joined with commas inside the `-target` arg; reject names
    // that themselves contain `,` so we don't silently split into bogus
    // targets.
    for (const t of opts.targets) {
      if (typeof t !== 'string' || t.includes(',')) {
        return Err.validation('targets', `target name must not contain ',': ${String(t)}`);
      }
    }

    const layers = opts.targets.map((t) => resolveLayerInList(dataset.layers, t));
    for (let i = 0; i < layers.length; i++) {
      if (!layers[i]) return Err.notFound('layer', opts.targets[i]);
    }

    if (!opts.force) {
      const firstGeom = layers[0]?.geometry_type;
      const allSame = layers.every((l) => l?.geometry_type === firstGeom);
      if (!allSame) {
        return Err.validation('targets', 'targets have mixed geometry types; pass `force: true` to merge anyway');
      }
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteCliArg(targetList)}`,
      '-merge-layers',
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteCliArg(opts.name)}`);
    }
    if (opts.force) parts.push('force');
    if (opts.flatten) parts.push('flatten');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Merge ${targetList}`);
  }

  /**
   * Partition a single layer into one output layer per distinct grouping
   * value via mapshaper's `-split`. The `expression` argument may be a
   * bare field name or a JS expression — mapshaper auto-detects.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   *
   * v1 omits the `apart` flag (which produces independent datasets); the
   * one-source-one-dataset model in emap doesn't expose those. Use
   * `loadSnapshot` with `defaultIds` if you need that workflow.
   */
  async splitLayer(opts: SplitLayerOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
    if (!this._emap._allowExpressionEvaluation([expr], 'splitLayer')) {
      return Err.expressionDisabled('splitLayer');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-split ${quoteCliArg(expr)}`,
    ];
    if (opts.noReplace) parts.push('no-replace');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Split ${opts.target}`);
  }

  /**
   * Delete a single layer from the source dataset via mapshaper's `-drop`.
   * mapshaper's `-drop` is multi-modal (layer / geometry / holes / fields);
   * v1 wraps only the "drop the entire layer" mode. Use {@link filterFields}
   * for the field-drop case.
   *
   * Returns `false` for unresolvable source / target.
   */
  async dropLayer(opts: DropLayerOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const cmd = `-target ${quoteCliArg(opts.target)} -drop`;
    return this._runDatasetCommand(opts.source, cmd, `Drop ${opts.target}`);
  }

  /**
   * Sort features within a layer by a JS expression via mapshaper's `-sort`.
   * Bare field names work directly. Default order is ascending; pass
   * `descending: true` for the reverse.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   */
  async sortFeatures(opts: SortFeaturesOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
    if (!this._emap._allowExpressionEvaluation([expr], 'sortFeatures')) {
      return Err.expressionDisabled('sortFeatures');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-sort ${quoteCliArg(expr)}`,
    ];
    if (opts.descending) parts.push('descending');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Sort ${opts.target}`);
  }

  /**
   * Drop duplicate features by an id expression via mapshaper's `-uniq`.
   * Pass `'JSON.stringify(this.properties)'` for full-record dedupe.
   *
   * Returns `false` for unresolvable source / target, empty expression,
   * or non-positive `maxCount`.
   */
  async uniqueFeatures(opts: UniqueFeaturesOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return Err.validation('expression', 'must be a non-empty expression');
    if (!this._emap._allowExpressionEvaluation([expr], 'uniqueFeatures')) {
      return Err.expressionDisabled('uniqueFeatures');
    }
    if (opts.maxCount !== undefined && !(typeof opts.maxCount === 'number' && opts.maxCount > 0)) {
      return Err.validation('maxCount', 'must be a positive number');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-uniq ${quoteCliArg(expr)}`,
    ];
    if (opts.maxCount !== undefined) parts.push(`max-count=${opts.maxCount}`);
    if (opts.invert) parts.push('invert');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Uniq ${opts.target}`);
  }

  /**
   * Retain only the listed attribute fields via mapshaper's `-filter-fields`.
   * Pass `invert: true` to drop the listed fields and keep the rest.
   *
   * Returns `false` for unresolvable source / target, empty `fields[]`,
   * or any field name that's empty or contains `,`.
   */
  async filterFields(opts: FilterFieldsOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!Array.isArray(opts.fields) || opts.fields.length === 0) {
      return Err.validation('fields', 'must be a non-empty array');
    }
    for (const f of opts.fields) {
      if (typeof f !== 'string' || f.trim().length === 0) {
        return Err.validation('fields', `field name must be a non-empty string: ${String(f)}`);
      }
      if (f.includes(',')) {
        return Err.validation('fields', `field name must not contain ',': ${f}`);
      }
    }

    const list = opts.fields.join(',');
    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-filter-fields ${quoteCliArg(list)}`,
    ];
    if (opts.invert) parts.push('invert');
    return this._runDatasetCommand(opts.source, parts.join(' '), `Filter fields ${opts.target}`);
  }

  /**
   * Bulk-rename multiple attribute fields via mapshaper's `-rename-fields`.
   * Mapping order is preserved (object iteration order). Both old and new
   * names must be non-empty after trimming and free of `,` / `=`.
   *
   * Returns `false` for unresolvable source / target or any invalid
   * key / value in `mapping`.
   */
  async renameFields(opts: RenameFieldsOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    if (!opts.mapping || typeof opts.mapping !== 'object') {
      return Err.validation('mapping', 'must be an object of { oldName: newName }');
    }
    const entries = Object.entries(opts.mapping);
    if (entries.length === 0) return Err.validation('mapping', 'must contain at least one rename pair');
    const pairs: string[] = [];
    for (const [oldName, newName] of entries) {
      const o = (oldName ?? '').trim();
      const n = (newName ?? '').trim();
      if (o.length === 0 || n.length === 0) {
        return Err.validation('mapping', `field names must be non-empty: ${oldName}=${newName}`);
      }
      if (o.includes(',') || o.includes('=') || n.includes(',') || n.includes('=')) {
        return Err.validation('mapping', `field names must not contain ',' or '=': ${oldName}=${newName}`);
      }
      pairs.push(`${o}=${n}`);
    }
    const list = pairs.join(',');
    const cmd = `-target ${quoteCliArg(opts.target)} -rename-fields ${quoteCliArg(list)}`;
    return this._runDatasetCommand(opts.source, cmd, `Rename fields ${opts.target}`);
  }

  /**
   * Read-only topology validation pass over a source's arcs via
   * `mapshaper.internal.findSegmentIntersections`. Reports self-intersection
   * count and a sample of intersection points; does NOT mutate the dataset
   * or push to history.
   *
   * Returns `null` for unresolvable source, missing dataset, or unresolved
   * `target`. For arc-less point-only datasets returns the empty/clean
   * report (vacuously valid).
   *
   * Lighter than {@link cleanLayer} (heavy + destructive) and complementary
   * to {@link rebuildTopology} (which fixes the issues this command finds).
   */
  async checkGeometry(opts: CheckGeometryOptions): Promise<OpResult<GeometryCheckReport>> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const dataset = source.getDataset();
    if (!dataset) return Err.notFound('source', opts.source);
    if (opts.target !== undefined) {
      if (!resolveLayerInList(dataset.layers, opts.target)) return Err.notFound('layer', opts.target);
    }
    if (!dataset.arcs) {
      return okValue({ ok: true, intersections: [], intersectionCount: 0 });
    }

    const internalOpts: { tolerance?: number } = {};
    if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

    const raw = mapshaper.internal.findSegmentIntersections(dataset.arcs, internalOpts);
    const intersections = raw.map((r) => ({ x: r.x, y: r.y }));
    return okValue({
      ok: intersections.length === 0,
      intersections,
      intersectionCount: intersections.length,
    });
  }

  /**
   * Materialize the self-intersection points of a polygon or polyline
   * target as a new point layer in the same source's dataset.
   *
   * Counterpart to {@link checkGeometry} — `checkGeometry` returns a
   * read-only report, while this op produces a renderable, selectable,
   * editable layer. Useful when the user wants to label or operate on
   * the intersection locations.
   *
   * mapshaper's CLI `-points intersections` flag is registered but its
   * implementation is a debug-only timing benchmark; this method
   * bypasses the CLI and uses `findSegmentIntersections` +
   * `getIntersectionLayer` directly, which DO produce the right output.
   *
   * Returns `false` for any of: missing source / dataset, unresolved
   * target, target geometry not polygon/polyline, name collision with
   * an existing layer, non-positive `tolerance`. On internal error
   * (mapshaper threw), fires `error` event and returns `false`.
   *
   * The resulting layer is one multi-point feature (mapshaper's
   * `getIntersectionLayer` returns `shapes: [points]`). Pipe through
   * `explodeLayer` if one feature per intersection is needed.
   */
  async intersectionPointsLayer(opts: IntersectionPointsLayerOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
    if (!source) return Err.notFound('source', opts.source);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', opts.source);
    const targetLayer = resolveLayerInList(original.layers, opts.target);
    if (!targetLayer) return Err.notFound('layer', opts.target);
    if (targetLayer.geometry_type !== 'polygon' && targetLayer.geometry_type !== 'polyline') {
      return Err.validation('target', `expected polygon/polyline target, got ${targetLayer.geometry_type ?? 'unknown'}`);
    }
    if (!original.arcs) return Err.validation('source', 'source has no arcs');

    const newName = (opts.name && opts.name.trim()) || `${opts.target}-intersections`;
    if (original.layers.some((l: any) => l?.name === newName)) {
      return Err.validation('name', `another layer already named '${newName}'`);
    }
    if (opts.tolerance !== undefined) {
      if (typeof opts.tolerance !== 'number' || !Number.isFinite(opts.tolerance) || opts.tolerance <= 0) {
        return Err.validation('tolerance', 'must be a positive finite number');
      }
    }

    const internalOpts: { tolerance?: number } = {};
    if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

    // Custom dataset-replace path. Snapshot for undo, do work on a deep
    // copy, swap. Mirrors `_runDatasetCommand` but skips parseCommands
    // because mapshaper's CLI `-points intersections` is broken upstream
    // — we go directly to the internal primitives.
    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);
    const after: MapshaperDataset = mapshaper.internal.copyDataset(original);

    let pointLyr: any;
    try {
      const intersections = mapshaper.internal.findSegmentIntersections(after.arcs!, internalOpts);
      // Find the cloned target inside the working copy by name.
      const workingTarget = resolveLayerInList(after.layers, opts.target);
      if (!workingTarget) {
        // Should never happen — target was in original, copyDataset preserves names.
        throw new Error('intersectionPointsLayer: target lost in copyDataset');
      }
      pointLyr = mapshaper.internal.getIntersectionLayer(intersections, workingTarget, after.arcs!);
      pointLyr.name = newName;
      after.layers.push(pointLyr);
    } catch (err) {
      this._emap.fire('error', { error: err });
      return Err.mapshaper(err, { operation: 'intersectionPointsLayer' });
    }

    source.setDataset(after);

    // Same history-barrier convention as every other dataset-replace op.
    this._emap._history.clear();
    this._emap._history.push(new DatasetReplaceCommand({
      source, before, after,
      label: `Intersection points ${opts.target}`,
    }));
    this._emap._fireHistoryChange();

    this._emap._fireSelectionChange(this._emap._selection.clear());
    this._emap._scheduleRender();
    return OK;
  }

  /**
   * Join attribute records from a CSV / JSON / another-layer source onto a
   * target layer via mapshaper's `-join`. The canonical "thematic shapefile
   * + CSV of measures → chloropleth" workflow.
   *
   * `data` is one of:
   * - `{ csv: string | Uint8Array }` — CSV bytes injected into the runner's
   *   input cache as `.emap-join.csv`.
   * - `{ json: string | Uint8Array | unknown[] | object }` — JSON bytes
   *   injected as `.emap-join.json`. Arrays/objects are stringified.
   * - `{ layer: string }` — by-name reference to another layer in the same
   *   source. No cache injection.
   *
   * Returns `false` for unresolvable source / target, malformed `keys`, or
   * an invalid `data` shape.
   */
  async joinTable(opts: JoinTableOptions): Promise<OpResult> {
    const source = this._emap._sources.get(opts.source);
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
    if (!this._emap._allowExpressionEvaluation([opts.where, opts.calc], 'joinTable')) {
      return Err.expressionDisabled('joinTable');
    }

    const parts: string[] = [
      `-target ${quoteCliArg(opts.target)}`,
      `-join ${quoteCliArg(joinSource)}`,
      `keys=${quoteCliArg(`${targetKey},${sourceKey}`)}`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.prefix && opts.prefix.length > 0) {
      parts.push(`prefix=${quoteCliArg(opts.prefix)}`);
    }
    if (opts.where && opts.where.trim().length > 0) {
      parts.push(`where=${quoteCliArg(opts.where)}`);
    }
    if (opts.calc && opts.calc.trim().length > 0) {
      parts.push(`calc=${quoteCliArg(opts.calc)}`);
    }
    if (opts.unjoined) parts.push('unjoined');
    if (opts.unmatched) parts.push('unmatched');

    return this._runDatasetCommand(
      opts.source,
      parts.join(' '),
      `Join ${opts.target}`,
      inputFiles,
    );
  }

  /**
   * Combine the currently-selected features (when they all live in the same
   * source/layer) into a single feature, recorded as one undoable history
   * entry.
   *
   * Implements the standard mapshaper recipe: tag selected features with a
   * temp discriminator field, run `-dissolve` on it, then drop the temp
   * field. Attribute fields are preserved via `copy-fields=` so unselected
   * single-feature groups keep their values and the merged group inherits
   * the FIRST selected feature's values (mapshaper's documented
   * data-aggregation behaviour).
   *
   * Returns `false` (and runs no command) for an empty selection or when
   * the selection spans more than one source/layer.
   */
  async mergeSelected(): Promise<OpResult> {
    const refs = this._emap._selection.getAll();
    if (refs.length === 0) return Err.validation('selection', 'selection is empty');

    // Reject cross-source / cross-layer selections — mapshaper's dissolve
    // operates on a single layer at a time.
    const sourceId = refs[0].source;
    const layerId = refs[0].layer;
    for (const r of refs) {
      if (r.source !== sourceId || r.layer !== layerId) {
        return Err.validation('selection', 'selection spans multiple sources or layers');
      }
    }

    const layer = this._emap.layers.resolve(sourceId, layerId);
    if (!layer) return Err.notFound('layer', layerId);

    // Sort selected ids ascending so the discriminator pre-write is
    // deterministic (helpful for tests + diffs).
    const ids = refs.map((r: { id: number }) => r.id).slice().sort((a: number, b: number) => a - b);

    // Stamp the discriminator field directly onto the records BEFORE running
    // mapshaper. This replaces the older "embed `JSON.stringify(ids)` into a
    // `-each` expression" recipe — that approach generated MB-sized command
    // strings for selections of 10k+ features and forced mapshaper to JS-eval
    // the membership test on every record. Direct record mutation is O(N)
    // either way and avoids the parser blow-up entirely.
    if (!stampMergeDiscriminator(layer, ids)) {
      return Err.validation('layer', 'layer has no data table; cannot stamp discriminator');
    }

    const cmd = buildMergeDissolveCommand(layerId, layer);
    const label = `Merge ${refs.length} feature${refs.length > 1 ? 's' : ''}`;
    const result = await this._runDatasetCommand(sourceId, cmd, label);
    if (!result.ok) {
      // The pre-stamp mutated the LIVE dataset's records. If the dissolve
      // bailed (host removed, mapshaper threw, …), unwind the stamp so the
      // caller's view of the data isn't polluted with our internal field.
      unstampMergeDiscriminator(layer);
    }
    return result;
  }
  /**
   * Worker-thread variant of {@link runMapshaperCommandOnDataset}: packs
   * the dataset via `exportDatasetsToPack({ compact: false })`, dispatches
   * to the pool, restores the result. Fires `workerjobstart` /
   * `workerjobend` events around the pool round-trip so UI code can show
   * a spinner without per-call wiring.
   */
  async _runViaWorker(
    dataset: MapshaperDataset,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<MapshaperDataset> {
    if (!this._emap._workerPool) {
      // Should never reach here — caller checks _workerPool. Defensive.
      throw new Error('_runViaWorker: worker pool not available');
    }
    // Fire workerjobstart BEFORE the synchronous pack work so a UI spinner
    // appears immediately. Pack on a 1M-vertex dataset takes ~500ms; firing
    // the event after pack delays UI feedback by exactly that amount.
    // Use the pool's id reservation so start/end events stay correlated.
    const id = this._emap._workerPool.reserveId();
    const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this._emap.fire('workerjobstart', { id, cmd, label, datasetVertexCount });

    try {
      const packed = await mapshaper.internal.exportDatasetsToPack([dataset], { compact: false });
      const promise = this._emap._workerPool.dispatchWithId(id, cmd, packed, inputFiles);
      const resultPacked = await promise;
      const restored = await mapshaper.internal.restoreSessionData(resultPacked);
      if (!restored.datasets || restored.datasets.length === 0) {
        throw new Error('worker: no dataset in response');
      }
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this._emap.fire('workerjobend', { id, ok: true, durationMs });
      return restored.datasets[0];
    } catch (err: any) {
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this._emap.fire('workerjobend', {
        id,
        ok: false,
        durationMs,
        errorMessage: err?.message ?? String(err),
      });
      throw err;
    }
  }

  async _runDatasetCommand(
    sourceId: string,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<OpResult> {
    // Stage A: pre-flight bail. If the host is already torn down, skip
    // the entire command — there is no UI left to update.
    if (this._emap._removed) return Err.hostRemoved();

    const source = this._emap._sources.get(sourceId);
    if (!source) return Err.notFound('source', sourceId);
    const original = source.getDataset();
    if (!original) return Err.notFound('source', sourceId);

    // Deep snapshot for undo. mapshaper's clip / erase / dissolve mutate the
    // input dataset in place; without this snapshot there is nothing to
    // restore on undo.
    const before: MapshaperDataset = getDefaultMapshaperAdapter().copyDataset(original);

    // Decide worker vs main-thread.
    // - false      → main-thread always
    // - true       → worker always (when pool exists)
    // - 'auto'     → worker when arc vertex count meets workerThreshold
    let useWorker = false;
    if (this._emap._workerPool) {
      if (this._emap._workerMode === true) {
        useWorker = true;
      } else if (this._emap._workerMode === 'auto') {
        const vertexCount = original.arcs?.getPointCount?.() ?? 0;
        useWorker = vertexCount >= this._emap._workerThreshold;
      }
    }

    let after: MapshaperDataset;
    try {
      if (useWorker) {
        after = await this._runViaWorker(original, cmd, label, inputFiles);
      } else {
        after = await runMapshaperCommandOnDataset(cmd, original, inputFiles);
      }
    } catch (err) {
      // Stage B: post-await error path. If the host is gone, swallow the
      // error silently — listeners are detached and surfacing it would
      // only confuse callers awaiting a clean shutdown.
      if (this._emap._removed) return Err.hostRemoved();
      // Surface as a fire-and-forget error event; do not throw from a public
      // edit op so that one bad command doesn't tear down the calling page.
      this._emap.fire('error', { error: err });
      return Err.mapshaper(err, { cmd, operation: label });
    }

    // Stage C: post-await success path. Drop the result on the floor if
    // the host was removed mid-await; mutating `_sources` / `_history`
    // now would either crash or resurrect freed state.
    if (this._emap._removed) return Err.hostRemoved();

    // Apply: swap the source's active dataset.
    source.setDataset(after);

    // History barrier: prior commands closed over the OLD dataset's layers /
    // arcs. Clearing keeps undo predictable; the dataset-replace itself is
    // the single new undoable step.
    this._emap._history.clear();
    this._emap._history.push(new DatasetReplaceCommand({ source, before, after, label }));
    this._emap._fireHistoryChange();

    // Selection refs are by feature id and may now point at different
    // features. Clear conservatively.
    this._emap._fireSelectionChange(this._emap._selection.clear());

    this._emap._scheduleRender();
    return OK;
  }
}

/** Internal field name used by `mergeSelected`'s discriminator pass. */
const MERGE_SELECTED_FIELD = '__emap_merge';

/**
 * Stamp the discriminator field onto each record IN PLACE so the subsequent
 * `-dissolve` collapses the selected rows into one.
 *
 *   - Selected rows get `'M'`.
 *   - Unselected rows get a unique `'k_<id>'` so they pass through dissolve
 *     unchanged.
 *
 * Returns `false` when the layer has no data table or no records — without
 * a record array there is nothing to stamp and dissolve would have no
 * group key.
 *
 * Direct mutation (rather than building a `-each` expression that does the
 * same work via `JSON.stringify(selectedIds).indexOf(this.id) >= 0 ? ... :
 * ...`) keeps the command string a constant size regardless of selection
 * cardinality. For a 10k-id selection the prior approach generated a
 * roughly 0.3 MB literal that mapshaper's parser had to tokenise and
 * mapshaper's `-each` had to JS-eval per record.
 */
function stampMergeDiscriminator(layer: MapshaperLayer, selectedIds: number[]): boolean {
  const records = layer.data?.getRecords?.();
  if (!records || records.length === 0) return false;
  const selected = new Set<number>(selectedIds);
  for (let i = 0; i < records.length; i++) {
    const r = records[i] ?? {};
    r[MERGE_SELECTED_FIELD] = selected.has(i) ? 'M' : `k_${i}`;
    records[i] = r;
  }
  return true;
}

/**
 * Reverse of {@link stampMergeDiscriminator}. Used when the dissolve fails
 * (host removed, mapshaper threw) so the live dataset doesn't end up with
 * the internal field clinging to it.
 */
function unstampMergeDiscriminator(layer: MapshaperLayer): void {
  const records = layer.data?.getRecords?.();
  if (!records) return;
  for (const r of records) {
    if (r && MERGE_SELECTED_FIELD in r) delete r[MERGE_SELECTED_FIELD];
  }
}

/**
 * Build the dissolve+cleanup command string. The discriminator field is
 * already stamped onto records by {@link stampMergeDiscriminator}; this
 * function just wires `-target` / `-dissolve` / `-filter-fields` together.
 *
 * Cleanup uses `-filter-fields __emap_merge invert` rather than
 * `-each "delete __emap_merge"` because deleting from a `with(record)`
 * scope by bare name doesn't remove the field from the DataTable schema —
 * the field would still appear in subsequent `getFields()` calls.
 */
function buildMergeDissolveCommand(layerName: string, layer: MapshaperLayer): string {
  // Build copy-fields= from the layer's data table when one exists.
  // Field names with commas are intentionally rejected (mapshaper's
  // copy-fields= is comma-delimited and does not quote individual entries).
  let copyFieldsArg = '';
  const fields = layer.data?.getFields?.();
  if (fields && fields.length > 0) {
    const safeFields = fields.filter(
      (f) => f !== MERGE_SELECTED_FIELD && !f.includes(','),
    );
    if (safeFields.length > 0) {
      copyFieldsArg = ` copy-fields=${safeFields.join(',')}`;
    }
  }

  return [
    `-target ${quoteCliArg(layerName)}`,
    `-dissolve ${quoteCliArg(MERGE_SELECTED_FIELD)}${copyFieldsArg}`,
    `-filter-fields ${MERGE_SELECTED_FIELD} invert`,
  ].join(' ');
}

/**
 * Run a mapshaper command string against a single dataset and resolve with
 * the resulting (post-mutation) dataset. Thin shim around the adapter so
 * the existing main-thread path stays callable; tests can swap behaviour
 * by injecting a mock adapter via {@link setDefaultMapshaperAdapter}.
 */
function runMapshaperCommandOnDataset(
  cmd: string,
  dataset: MapshaperDataset,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  return getDefaultMapshaperAdapter().runOnDataset(cmd, dataset, inputFiles);
}
