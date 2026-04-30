// Mapshaper command wrappers. Extracted from map.ts so the orchestrator
// stays focused on render / lifecycle. Methods are mixed onto
// `Emap.prototype` via `Object.assign` at the bottom of `map.ts`. Each
// method's `this: any` parameter opts the body out of strict private-
// access checks against `Emap` — the public surface is enforced by
// `MapshaperOpsApi` (interface-merged onto `Emap` in `map.ts`).

import mapshaper from 'mapshaper';
import { DatasetReplaceCommand } from '../edit/commands/dataset-replace';
import type { MapshaperDataset, MapshaperLayer } from '../types/mapshaper-types';
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

/** Public method surface this mixin contributes to `Emap`. */
export interface MapshaperOpsApi {
  clipLayer(opts: ClipEraseOptions): Promise<boolean>;
  eraseLayer(opts: ClipEraseOptions): Promise<boolean>;
  dissolveLayer(opts: DissolveOptions): Promise<boolean>;
  bufferLayer(opts: BufferOptions): Promise<boolean>;
  applyExpression(opts: ApplyExpressionOptions): Promise<boolean>;
  explodeLayer(opts: ExplodeOptions): Promise<boolean>;
  innerlinesLayer(opts: InnerlinesOptions): Promise<boolean>;
  filterFeatures(opts: FilterOptions): Promise<boolean>;
  snapLayer(opts: SnapOptions): Promise<boolean>;
  cleanLayer(opts: CleanOptions): Promise<boolean>;
  rebuildTopology(opts: RebuildTopologyOptions): Promise<boolean>;
  mosaicLayer(opts: MosaicOptions): Promise<boolean>;
  unionLayers(opts: UnionOptions): Promise<boolean>;
  divideLayer(opts: DivideOptions): Promise<boolean>;
  pointsLayer(opts: PointsOptions): Promise<boolean>;
  linesLayer(opts: LinesOptions): Promise<boolean>;
  polygonsLayer(opts: PolygonsOptions): Promise<boolean>;
  simplifyLayer(opts: SimplifyOptions): Promise<boolean>;
  projectLayer(opts: ProjectOptions): Promise<boolean>;
  renameLayer(opts: RenameLayerOptions): Promise<boolean>;
  mergeLayers(opts: MergeLayersOptions): Promise<boolean>;
  splitLayer(opts: SplitLayerOptions): Promise<boolean>;
  dropLayer(opts: DropLayerOptions): Promise<boolean>;
  sortFeatures(opts: SortFeaturesOptions): Promise<boolean>;
  uniqueFeatures(opts: UniqueFeaturesOptions): Promise<boolean>;
  filterFields(opts: FilterFieldsOptions): Promise<boolean>;
  renameFields(opts: RenameFieldsOptions): Promise<boolean>;
  checkGeometry(opts: CheckGeometryOptions): Promise<GeometryCheckReport | null>;
  intersectionPointsLayer(opts: IntersectionPointsLayerOptions): Promise<boolean>;
  joinTable(opts: JoinTableOptions): Promise<boolean>;
  mergeSelected(): Promise<boolean>;
}

class _MapshaperOpsMixin {
  async clipLayer(this: any, opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'clip');
  }

  /**
   * Erase (cut holes from) a layer using a polygon mask layer via mapshaper's
   * `-erase` pipeline. Same semantics as {@link clipLayer}.
   */
  async eraseLayer(this: any, opts: ClipEraseOptions): Promise<boolean> {
    return this._runClipErase(opts, 'erase');
  }

  async _runClipErase(this: any, opts: ClipEraseOptions, op: 'clip' | 'erase'): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    // Validate that both target and mask resolve to layers in this source's
    // dataset. mapshaper would throw an opaque error otherwise.
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!findLayerByName(dataset.layers, opts.mask)) return false;

    const verb = op === 'clip' ? 'Clip' : 'Erase';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -${op} source=${quoteMapshaperArg(opts.mask)}`;
    return this._runDatasetCommand(opts.source, cmd, `${verb} ${opts.target}`);
  }

  /**
   * Merge polygon (or point / polyline) features in the target layer using
   * mapshaper's `-dissolve` pipeline. Without `field`, all features in the
   * layer collapse into one; with `field`, features sharing the same field
   * value are merged. Returns `true` on success, `false` for unresolvable
   * source / target. Recorded as a single undoable history entry.
   */
  async dissolveLayer(this: any, opts: DissolveOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // `field` (single) and `fields` (multi) are mutually exclusive — both
    // set is a configuration error.
    const hasFields = Array.isArray(opts.fields) && opts.fields.length > 0;
    if (opts.field !== undefined && hasFields) return false;

    // mapshaper's -dissolve DEFAULT option is `fields` (comma-list, type
    // strings). A field name containing `,` would silently group by N
    // imaginary fields; reject up-front instead.
    if (opts.field !== undefined && (typeof opts.field !== 'string' || opts.field.includes(','))) {
      return false;
    }
    if (!this._allowExpressionEvaluation([opts.calc, opts.where], 'dissolveLayer')) return false;

    // Build the positional group-by token (single-field convenience or
    // multi-field array). When neither is set, dissolve collapses every
    // feature into one (mapshaper's default for -dissolve with no key).
    let groupToken = '';
    if (opts.field) {
      groupToken = ` ${quoteMapshaperArg(opts.field)}`;
    } else if (hasFields) {
      const safeFields = opts.fields!.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safeFields.length > 0) {
        groupToken = ` ${quoteMapshaperArg(safeFields.join(','))}`;
      }
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
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
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
    }
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.multipart) parts.push('multipart');
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async bufferLayer(this: any, opts: BufferOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // Validate numeric radius up-front: 0 silently produces empty buffers,
    // negative values throw inside mapshaper. Expression-string radii are
    // forwarded as-is — mapshaper evaluates per-feature and there's no
    // sound way to validate them without parsing JS.
    if (typeof opts.radius === 'number') {
      if (!Number.isFinite(opts.radius) || opts.radius <= 0) return false;
    } else if (typeof opts.radius !== 'string' || opts.radius.trim().length === 0) {
      return false;
    }
    if (typeof opts.radius === 'string' && !this._allowExpressionEvaluation([opts.radius], 'bufferLayer')) {
      return false;
    }

    // Numbers go in bare; expression strings are quoted so the shell-style
    // command parser keeps them intact.
    const radiusArg =
      typeof opts.radius === 'number' ? String(opts.radius) : quoteMapshaperArg(opts.radius);
    const capArg = opts.capStyle ? ` cap-style=${opts.capStyle}` : '';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -buffer ${radiusArg}${capArg}`;
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
  async applyExpression(this: any, opts: ApplyExpressionOptions): Promise<boolean> {
    if (!opts.expression || !opts.expression.trim()) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.expression, opts.where], 'applyExpression')) return false;

    const whereArg = opts.where && opts.where.trim()
      ? ` where=${quoteMapshaperArg(opts.where)}`
      : '';
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -each ${quoteMapshaperArg(opts.expression)}${whereArg}`;
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
  async explodeLayer(this: any, opts: ExplodeOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -explode`;
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
  async innerlinesLayer(this: any, opts: InnerlinesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.where], 'innerlinesLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-innerlines`,
    ];
    if (opts.where && opts.where.trim()) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async filterFeatures(this: any, opts: FilterOptions): Promise<boolean> {
    const hasExpr = !!(opts.expression && opts.expression.trim());
    if (!hasExpr && !opts.removeEmpty) return false;

    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.expression], 'filterFeatures')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-filter`,
    ];
    if (hasExpr) {
      parts.push(quoteMapshaperArg(opts.expression as string));
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
  async snapLayer(this: any, opts: SnapOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
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
   * every import. Returns `Promise<boolean>`; failure modes match the other
   * dataset-replace ops (false on unresolvable source/target, error event on
   * mapshaper failure).
   *
   * All tuning options are optional; omitting them lets mapshaper apply its
   * default cleanup heuristics. See {@link CleanOptions} for the surface.
   */
  async cleanLayer(this: any, opts: CleanOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;

    // Numeric tuning options reject NaN / negative — mapshaper would either
    // error opaquely or silently produce surprising results.
    const validNumOrUnset = (n?: number) =>
      n === undefined || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
    if (!validNumOrUnset(opts.gapFillArea)) return false;
    if (!validNumOrUnset(opts.sliverControl)) return false;
    if (!validNumOrUnset(opts.snapInterval)) return false;

    if (opts.overlapRule !== undefined) {
      const allowed = ['min-id', 'max-id', 'min-area', 'max-area'];
      if (!allowed.includes(opts.overlapRule)) return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
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
  async rebuildTopology(this: any, opts: RebuildTopologyOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;
    if (!original.arcs) return true; // point-only — nothing to rebuild

    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);
    const after: MapshaperDataset = mapshaper.internal.copyDataset(original);

    try {
      mapshaper.internal.addIntersectionCuts(after, {
        snap_interval: opts.snapInterval,
        no_snap: opts.noSnap,
        rebuild_topology: opts.rebuildTopology,
      });
    } catch (err) {
      this.fire('error', { error: err });
      return false;
    }

    source.setDataset(after);

    this._history.clear();
    this._history.push(new DatasetReplaceCommand({ source, before, after, label: 'Rebuild topology' }));
    this._fireHistoryChange();

    this._fireSelectionChange(this._selection.clear());

    this._scheduleRender();
    return true;
  }

  /**
   * Flatten overlapping polygons in a single layer into a tile mosaic via
   * mapshaper's `-mosaic`. Every overlap region becomes its own polygon;
   * gaps are preserved.
   *
   * Returns `false` for unresolvable source / target. Inherits all
   * dataset-replace semantics from `_runDatasetCommand`.
   */
  async mosaicLayer(this: any, opts: MosaicOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!this._allowExpressionEvaluation([opts.calc], 'mosaicLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
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
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
    }
    if (opts.calc && opts.calc.trim()) {
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
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
  async unionLayers(this: any, opts: UnionOptions): Promise<boolean> {
    if (!opts.targets || opts.targets.length < 2) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    // Every target must resolve and be `,`-free — mapshaper joins the list
    // with commas and would otherwise silently split a comma-bearing name
    // into multiple bogus targets.
    for (const t of opts.targets) {
      if (typeof t !== 'string' || t.includes(',')) return false;
      if (!findLayerByName(dataset.layers, t)) return false;
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(targetList)}`,
      `-union`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async divideLayer(this: any, opts: DivideOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const targetLayer = findLayerByName(dataset.layers, opts.target);
    if (!targetLayer || targetLayer.geometry_type !== 'polyline') return false;
    const dividerLayer = findLayerByName(dataset.layers, opts.divider);
    if (!dividerLayer || dividerLayer.geometry_type !== 'polygon') return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-divide source=${quoteMapshaperArg(opts.divider)}`,
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
  async pointsLayer(this: any, opts: PointsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer) return false;

    const geom = layer.geometry_type;
    switch (opts.type) {
      case 'centroid':
      case 'inner':
        if (geom !== 'polygon') return false;
        break;
      case 'midpoints':
      case 'interpolated':
        if (geom !== 'polyline') return false;
        break;
      case 'vertices':
      case 'endpoints':
        if (geom !== 'polygon' && geom !== 'polyline') return false;
        break;
      default:
        return false;
    }
    if (opts.type === 'interpolated' && !(typeof opts.interval === 'number' && opts.interval > 0)) {
      return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-points ${opts.type}`,
    ];
    if (opts.type === 'interpolated') {
      parts.push(`interval=${opts.interval}`);
    }
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async linesLayer(this: any, opts: LinesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer || layer.geometry_type !== 'polygon') return false;

    // mapshaper's `-lines` DEFAULT positional is the comma-joined fields
    // list. Build the `-lines [fields-csv]` token in one place rather than
    // pushing a placeholder and rewriting it.
    const safeFields = opts.fields?.filter((f) => typeof f === 'string' && !f.includes(','));
    const linesToken = safeFields && safeFields.length > 0
      ? `-lines ${safeFields.join(',')}`
      : '-lines';

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      linesToken,
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async polygonsLayer(this: any, opts: PolygonsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    const layer = findLayerByName(dataset.layers, opts.target);
    if (!layer || layer.geometry_type !== 'polyline') return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
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
  async simplifyLayer(this: any, opts: SimplifyOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return false;
    }

    // Exactly one threshold mode.
    const thresholdsSet = [
      opts.percentage !== undefined,
      opts.interval !== undefined,
      opts.resolution !== undefined,
    ].filter(Boolean).length;
    if (thresholdsSet !== 1) return false;

    let thresholdToken: string;
    if (opts.percentage !== undefined) {
      const p = opts.percentage;
      if (!Number.isFinite(p) || p < 0 || p > 100) return false;
      thresholdToken = `${p}%`;
    } else if (opts.interval !== undefined) {
      const v = opts.interval;
      if (!Number.isFinite(v) || v <= 0) return false;
      thresholdToken = `interval=${v}`;
    } else {
      const r = opts.resolution!;
      if (!/^\d+x\d+$/.test(r)) return false;
      thresholdToken = `resolution=${r}`;
    }

    // `weighting` only makes sense for weighted-Visvalingam. mapshaper
    // silently ignores `weighting` when method is `dp` or `visvalingam`,
    // which leaves the caller wondering why their tuning had no effect.
    // Reject up-front. (Method `undefined` is fine — defaults to weighted.)
    if (opts.weighting !== undefined && opts.method !== undefined && opts.method !== 'weighted') {
      return false;
    }

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteMapshaperArg(opts.target)}`);
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
  async projectLayer(this: any, opts: ProjectOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return false;
    }
    const crs = (opts.crs ?? '').trim();
    if (crs.length === 0) return false;

    const parts: string[] = [];
    if (opts.target) parts.push(`-target ${quoteMapshaperArg(opts.target)}`);
    parts.push(`-proj ${quoteMapshaperArg(crs)}`);
    if (opts.init && opts.init.trim()) {
      parts.push(`init=${quoteMapshaperArg(opts.init)}`);
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
  async renameLayer(this: any, opts: RenameLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const newName = (opts.name ?? '').trim();
    if (newName.length === 0) return false;
    // mapshaper's -rename-layers DEFAULT is `names` (comma-list). A name
    // containing `,` would silently split into N rename pairs.
    if (newName.includes(',')) return false;
    // Allow renaming to the same name (no-op-ish), but reject if another
    // layer in this dataset already owns it.
    if (newName !== opts.target) {
      const collision = dataset.layers.some(
        (l: any) => (l?.name ?? '') === newName,
      );
      if (collision) return false;
    }
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -rename-layers ${quoteMapshaperArg(newName)}`;
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
  async mergeLayers(this: any, opts: MergeLayersOptions): Promise<boolean> {
    if (!opts.targets || opts.targets.length < 2) return false;
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;

    // Targets are joined with commas inside the `-target` arg; reject names
    // that themselves contain `,` so we don't silently split into bogus
    // targets.
    if (opts.targets.some((t) => typeof t !== 'string' || t.includes(','))) return false;

    const layers = opts.targets.map((t) => findLayerByName(dataset.layers, t));
    if (layers.some((l) => !l)) return false;

    if (!opts.force) {
      const firstGeom = layers[0]?.geometry_type;
      const allSame = layers.every((l) => l?.geometry_type === firstGeom);
      if (!allSame) return false;
    }

    const targetList = opts.targets.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(targetList)}`,
      '-merge-layers',
    ];
    if (opts.name && opts.name.trim()) {
      parts.push(`name=${quoteMapshaperArg(opts.name)}`);
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
  async splitLayer(this: any, opts: SplitLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'splitLayer')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-split ${quoteMapshaperArg(expr)}`,
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
  async dropLayer(this: any, opts: DropLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -drop`;
    return this._runDatasetCommand(opts.source, cmd, `Drop ${opts.target}`);
  }

  /**
   * Sort features within a layer by a JS expression via mapshaper's `-sort`.
   * Bare field names work directly. Default order is ascending; pass
   * `descending: true` for the reverse.
   *
   * Returns `false` for unresolvable source / target or empty expression.
   */
  async sortFeatures(this: any, opts: SortFeaturesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'sortFeatures')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-sort ${quoteMapshaperArg(expr)}`,
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
  async uniqueFeatures(this: any, opts: UniqueFeaturesOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    const expr = (opts.expression ?? '').trim();
    if (expr.length === 0) return false;
    if (!this._allowExpressionEvaluation([expr], 'uniqueFeatures')) return false;
    if (opts.maxCount !== undefined && !(typeof opts.maxCount === 'number' && opts.maxCount > 0)) {
      return false;
    }

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-uniq ${quoteMapshaperArg(expr)}`,
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
  async filterFields(this: any, opts: FilterFieldsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!Array.isArray(opts.fields) || opts.fields.length === 0) return false;
    for (const f of opts.fields) {
      if (typeof f !== 'string' || f.trim().length === 0) return false;
      if (f.includes(',')) return false;
    }

    const list = opts.fields.join(',');
    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-filter-fields ${quoteMapshaperArg(list)}`,
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
  async renameFields(this: any, opts: RenameFieldsOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!opts.mapping || typeof opts.mapping !== 'object') return false;
    const entries = Object.entries(opts.mapping);
    if (entries.length === 0) return false;
    const pairs: string[] = [];
    for (const [oldName, newName] of entries) {
      const o = (oldName ?? '').trim();
      const n = (newName ?? '').trim();
      if (o.length === 0 || n.length === 0) return false;
      if (o.includes(',') || o.includes('=') || n.includes(',') || n.includes('=')) return false;
      pairs.push(`${o}=${n}`);
    }
    const list = pairs.join(',');
    const cmd = `-target ${quoteMapshaperArg(opts.target)} -rename-fields ${quoteMapshaperArg(list)}`;
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
  async checkGeometry(this: any, opts: CheckGeometryOptions): Promise<GeometryCheckReport | null> {
    const source = this._sources.get(opts.source);
    if (!source) return null;
    const dataset = source.getDataset();
    if (!dataset) return null;
    if (opts.target !== undefined) {
      if (!findLayerByName(dataset.layers, opts.target)) return null;
    }
    if (!dataset.arcs) {
      return { ok: true, intersections: [], intersectionCount: 0 };
    }

    const internalOpts: { tolerance?: number } = {};
    if (opts.tolerance !== undefined) internalOpts.tolerance = opts.tolerance;

    const raw = mapshaper.internal.findSegmentIntersections(dataset.arcs, internalOpts);
    const intersections = raw.map((r) => ({ x: r.x, y: r.y }));
    return {
      ok: intersections.length === 0,
      intersections,
      intersectionCount: intersections.length,
    };
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
  async intersectionPointsLayer(this: any, opts: IntersectionPointsLayerOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;
    const targetLayer = findLayerByName(original.layers, opts.target);
    if (!targetLayer) return false;
    if (targetLayer.geometry_type !== 'polygon' && targetLayer.geometry_type !== 'polyline') {
      return false;
    }
    if (!original.arcs) return false;

    const newName = (opts.name && opts.name.trim()) || `${opts.target}-intersections`;
    if (original.layers.some((l: any) => l?.name === newName)) return false;
    if (opts.tolerance !== undefined) {
      if (typeof opts.tolerance !== 'number' || !Number.isFinite(opts.tolerance) || opts.tolerance <= 0) {
        return false;
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
      const workingTarget = findLayerByName(after.layers, opts.target);
      if (!workingTarget) {
        // Should never happen — target was in original, copyDataset preserves names.
        throw new Error('intersectionPointsLayer: target lost in copyDataset');
      }
      pointLyr = mapshaper.internal.getIntersectionLayer(intersections, workingTarget, after.arcs!);
      pointLyr.name = newName;
      after.layers.push(pointLyr);
    } catch (err) {
      this.fire('error', { error: err });
      return false;
    }

    source.setDataset(after);

    // Same history-barrier convention as every other dataset-replace op.
    this._history.clear();
    this._history.push(new DatasetReplaceCommand({
      source, before, after,
      label: `Intersection points ${opts.target}`,
    }));
    this._fireHistoryChange();

    this._fireSelectionChange(this._selection.clear());
    this._scheduleRender();
    return true;
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
  async joinTable(this: any, opts: JoinTableOptions): Promise<boolean> {
    const source = this._sources.get(opts.source);
    if (!source) return false;
    const dataset = source.getDataset();
    if (!dataset) return false;
    if (!findLayerByName(dataset.layers, opts.target)) return false;
    if (!Array.isArray(opts.keys) || opts.keys.length !== 2) return false;
    const [targetKey, sourceKey] = opts.keys.map((k) => (typeof k === 'string' ? k.trim() : ''));
    if (targetKey.length === 0 || sourceKey.length === 0) return false;
    // mapshaper serializes `keys=` as `target,source`; a key containing `,`
    // would split into 3+ keys and trip mapshaper's length validator.
    if (targetKey.includes(',') || sourceKey.includes(',')) return false;

    let joinSource: string;
    let inputFiles: Record<string, Uint8Array | string> | undefined;
    const data = opts.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return false;

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
      return false;
    }
    if (!this._allowExpressionEvaluation([opts.where, opts.calc], 'joinTable')) return false;

    const parts: string[] = [
      `-target ${quoteMapshaperArg(opts.target)}`,
      `-join ${quoteMapshaperArg(joinSource)}`,
      `keys=${quoteMapshaperArg(`${targetKey},${sourceKey}`)}`,
    ];
    if (opts.fields && opts.fields.length > 0) {
      const safe = opts.fields.filter((f) => typeof f === 'string' && !f.includes(','));
      if (safe.length > 0) parts.push(`fields=${safe.join(',')}`);
    }
    if (opts.prefix && opts.prefix.length > 0) {
      parts.push(`prefix=${quoteMapshaperArg(opts.prefix)}`);
    }
    if (opts.where && opts.where.trim().length > 0) {
      parts.push(`where=${quoteMapshaperArg(opts.where)}`);
    }
    if (opts.calc && opts.calc.trim().length > 0) {
      parts.push(`calc=${quoteMapshaperArg(opts.calc)}`);
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
  async mergeSelected(this: any): Promise<boolean> {
    const refs = this._selection.getAll();
    if (refs.length === 0) return false;

    // Reject cross-source / cross-layer selections — mapshaper's dissolve
    // operates on a single layer at a time.
    const sourceId = refs[0].source;
    const layerId = refs[0].layer;
    for (const r of refs) {
      if (r.source !== sourceId || r.layer !== layerId) return false;
    }

    const layer = this._resolveLayer(sourceId, layerId);
    if (!layer) return false;

    // Sort selected ids ascending so the embedded JSON literal is
    // deterministic (helpful for tests + diffs).
    const ids = refs.map((r: { id: number }) => r.id).slice().sort((a: number, b: number) => a - b);

    const cmd = buildMergeSelectedCommand(layerId, ids, layer);
    const label = `Merge ${refs.length} feature${refs.length > 1 ? 's' : ''}`;
    return this._runDatasetCommand(sourceId, cmd, label);
  }
  /**
   * Worker-thread variant of {@link runMapshaperCommandOnDataset}: packs
   * the dataset via `exportDatasetsToPack({ compact: false })`, dispatches
   * to the pool, restores the result. Fires `workerjobstart` /
   * `workerjobend` events around the pool round-trip so UI code can show
   * a spinner without per-call wiring.
   */
  async _runViaWorker(
    this: any,
    dataset: MapshaperDataset,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<MapshaperDataset> {
    if (!this._workerPool) {
      // Should never reach here — caller checks _workerPool. Defensive.
      throw new Error('_runViaWorker: worker pool not available');
    }
    // Fire workerjobstart BEFORE the synchronous pack work so a UI spinner
    // appears immediately. Pack on a 1M-vertex dataset takes ~500ms; firing
    // the event after pack delays UI feedback by exactly that amount.
    // Use the pool's id reservation so start/end events stay correlated.
    const id = this._workerPool.reserveId();
    const datasetVertexCount = dataset.arcs?.getPointCount?.() ?? 0;
    const startedAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    this.fire('workerjobstart', { id, cmd, label, datasetVertexCount });

    try {
      const packed = await mapshaper.internal.exportDatasetsToPack([dataset], { compact: false });
      const promise = this._workerPool.dispatchWithId(id, cmd, packed, inputFiles);
      const resultPacked = await promise;
      const restored = await mapshaper.internal.restoreSessionData(resultPacked);
      if (!restored.datasets || restored.datasets.length === 0) {
        throw new Error('worker: no dataset in response');
      }
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this.fire('workerjobend', { id, ok: true, durationMs });
      return restored.datasets[0];
    } catch (err: any) {
      const durationMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt;
      this.fire('workerjobend', {
        id,
        ok: false,
        durationMs,
        errorMessage: err?.message ?? String(err),
      });
      throw err;
    }
  }

  async _runDatasetCommand(
    this: any,
    sourceId: string,
    cmd: string,
    label: string,
    inputFiles?: Record<string, Uint8Array | string>,
  ): Promise<boolean> {
    const source = this._sources.get(sourceId);
    if (!source) return false;
    const original = source.getDataset();
    if (!original) return false;

    // Deep snapshot for undo. mapshaper's clip / erase / dissolve mutate the
    // input dataset in place; without this snapshot there is nothing to
    // restore on undo.
    const before: MapshaperDataset = mapshaper.internal.copyDataset(original);

    // Decide worker vs main-thread.
    // - false      → main-thread always
    // - true       → worker always (when pool exists)
    // - 'auto'     → worker when arc vertex count meets workerThreshold
    let useWorker = false;
    if (this._workerPool) {
      if (this._workerMode === true) {
        useWorker = true;
      } else if (this._workerMode === 'auto') {
        const vertexCount = original.arcs?.getPointCount?.() ?? 0;
        useWorker = vertexCount >= this._workerThreshold;
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
      // Surface as a fire-and-forget error event; do not throw from a public
      // edit op so that one bad command doesn't tear down the calling page.
      this.fire('error', { error: err });
      return false;
    }

    // Apply: swap the source's active dataset.
    source.setDataset(after);

    // History barrier: prior commands closed over the OLD dataset's layers /
    // arcs. Clearing keeps undo predictable; the dataset-replace itself is
    // the single new undoable step.
    this._history.clear();
    this._history.push(new DatasetReplaceCommand({ source, before, after, label }));
    this._fireHistoryChange();

    // Selection refs are by feature id and may now point at different
    // features. Clear conservatively.
    this._fireSelectionChange(this._selection.clear());

    this._scheduleRender();
    return true;
  }
}
export const mapshaperOpsMixin = _MapshaperOpsMixin.prototype;

function findLayerByName(layers: MapshaperLayer[], nameOrId: string): MapshaperLayer | null {
  for (const layer of layers) {
    if (layer.name === nameOrId || layer.id === nameOrId) return layer;
  }
  return null;
}

/**
 * Quote a layer name so it can be embedded in a mapshaper command string.
 * mapshaper accepts double-quoted arguments; we escape any embedded quotes.
 */
function quoteMapshaperArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Internal field name used by `mergeSelected`'s discriminator pass. */
const MERGE_SELECTED_FIELD = '__emap_merge';

/**
 * Build the mapshaper command string that implements `mergeSelected` for
 * one (target layer, selected ids) pair. Recipe:
 *   1. Tag every record with a discriminator field — selected rows get
 *      'M', unselected rows get a unique value so they pass through.
 *   2. Run `-dissolve` on the discriminator with `copy-fields=` listing
 *      every original field so attributes survive.
 *   3. Drop the discriminator field via `-filter-fields ... invert`.
 *
 * IMPORTANT: mapshaper's `-each` interprets BARE assignments
 * (`foo = ...`) as writes to the record, but `this.foo = ...` writes to
 * the synthetic feature proxy and is silently dropped (see
 * `mapshaper-feature-expressions.mjs`). The discriminator is therefore
 * assigned bare; reads of `this.id` / `this.<field>` still proxy through
 * the feature object and work normally.
 *
 * Cleanup uses `-filter-fields __emap_merge invert` rather than
 * `-each "delete __emap_merge"` because deleting from a `with(record)`
 * scope by bare name doesn't remove the field from the DataTable schema
 * — the field would still appear in subsequent `getFields()` calls.
 *
 * Returns the full command as a single string suitable for
 * `mapshaper.internal.parseCommands`.
 */
function buildMergeSelectedCommand(
  layerName: string,
  selectedIds: number[],
  layer: MapshaperLayer,
): string {
  // JSON.stringify produces a stable, parser-safe array literal.
  const idsJSON = JSON.stringify(selectedIds);
  // Single quotes wrap the JS expression; literal string values inside
  // use double quotes so they don't collide with the outer delimiter.
  const tagExpr =
    `'${MERGE_SELECTED_FIELD} = ${idsJSON}.indexOf(this.id) >= 0 ? "M" : "k_" + this.id'`;

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
    `-target ${quoteMapshaperArg(layerName)}`,
    `-each ${tagExpr}`,
    `-dissolve ${quoteMapshaperArg(MERGE_SELECTED_FIELD)}${copyFieldsArg}`,
    `-filter-fields ${MERGE_SELECTED_FIELD} invert`,
  ].join(' ');
}

/**
 * Run a mapshaper command string against a single dataset and resolve with
 * the resulting (post-mutation) dataset. Wraps the parseCommands +
 * runParsedCommands + Job dance in a Promise.
 */
function runMapshaperCommandOnDataset(
  cmd: string,
  dataset: MapshaperDataset,
  inputFiles?: Record<string, Uint8Array | string>,
): Promise<MapshaperDataset> {
  return new Promise((resolve, reject) => {
    const job = new mapshaper.internal.Job();
    job.catalog.addDataset(dataset);
    const commands = mapshaper.internal.parseCommands(cmd);
    if (inputFiles) {
      // mapshaper resolves filename references in command args via
      // `cli.readFile(name, null, opts.input)`, so the cache must be present
      // on every command's options. Cheap to set on all of them.
      for (const c of commands) {
        if (c.options) c.options.input = inputFiles;
      }
    }
    mapshaper.internal.runParsedCommands(commands, job, (err: any, finished) => {
      if (err) {
        reject(err);
        return;
      }
      const targets = finished.catalog.getDefaultTargets();
      if (targets.length > 0) {
        resolve(targets[0].dataset);
      } else {
        // mapshaper sometimes leaves the input dataset untouched if no target
        // applied — treat as success and return the original ref.
        resolve(dataset);
      }
    });
  });
}
