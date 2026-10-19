import Flatbush from 'flatbush';
import type { AffineTransform } from '../../domain/geo/transform';
import { normalizePointShape } from '../../domain/source/layer-utils';
import type { MapshaperDataset, MapshaperLayer } from '../../shared/types/mapshaper-types';
import type { CircleLayerSpecification } from '../map/layer';

/** Parallel original feature/component IDs, in source drawing order. */
export interface PointLodSelection {
  featureIds: Uint32Array;
  componentIds: Uint32Array;
}

/** Full CSS viewport, independent of the (possibly tiny) query rectangle. */
export interface PointLodView {
  width: number;
  height: number;
  /** Full-view original candidates, consulted only at a budget-limited scale. */
  getCandidates?: () => Uint32Array | null;
  /** Conservative full-view bounds, never the pointer query rectangle. */
  bounds?: readonly number[];
  /** Record the actual painted level and crop for CSS snapshot navigation. */
  painting?: boolean;
}

interface Level {
  selection: PointLodSelection;
  index: InstanceType<typeof Flatbush> | null;
  bounds: readonly number[];
  query?: { bounds: readonly number[]; selection: PointLodSelection };
}

interface Entry {
  source: string;
  dataset: MapshaperDataset | undefined;
  layer: MapshaperLayer;
  shapes: MapshaperLayer['shapes'];
  count: number;
  edit: number;
  attribute: number;
  crs: unknown;
  mask: Uint8Array | null;
  cellSize: number;
  budget: number;
  levels: Map<number, Level>;
  local?: {
    requested: number;
    candidates: Uint32Array | null;
    bounds: readonly number[] | undefined;
    level: Level | null;
  };
  bypassBelow: number;
  budgetFloor: number;
  small: boolean;
  painted?: { level: Level | null; bounds: readonly number[] };
}

const MIN_POINTS = 10_000;
const MAX_LEVELS = 3;
// Bound transient grid construction as well as retained indexes. 80 bytes per
// representative is a budgeting unit, not a JS heap guarantee.
const GRID_MEMORY_BUDGET = 64 * 1024 * 1024;
const REPRESENTATIVE_BYTES = 80;
// Keep point painting bounded independently of viewport resolution. A 4K viewport
// otherwise admits >400k representatives, which shifts the bottleneck from the
// LOD index to Canvas path construction and produces long frames.
const MAX_PAINT_REPRESENTATIVES = 150_000;
const DEFAULT_VIEW = { width: 1024, height: 768 };
const EMPTY: PointLodSelection = { featureIds: new Uint32Array(), componentIds: new Uint32Array() };

function matches(
  entry: Entry,
  spec: CircleLayerSpecification,
  layer: MapshaperLayer,
  dataset: MapshaperDataset | undefined,
  mask: Uint8Array | null,
): boolean {
  return (
    entry.source === spec.source &&
    entry.dataset === dataset &&
    entry.layer === layer &&
    entry.shapes === layer.shapes &&
    entry.count === layer.shapes?.length &&
    entry.edit === (dataset?.editVersion ?? 0) &&
    entry.attribute === (dataset?.attributeVersion ?? 0) &&
    entry.crs === dataset?.info?.crs &&
    entry.mask === mask &&
    entry.cellSize === (spec.pointLod === false ? 0 : (spec.pointLod?.cellSize ?? 8))
  );
}

function queryLevel(level: Level, bounds: readonly number[]): PointLodSelection {
  if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) return EMPTY;
  const extent = level.bounds;
  if (
    !level.index ||
    (bounds[0] <= extent[0] &&
      bounds[1] <= extent[1] &&
      bounds[2] >= extent[2] &&
      bounds[3] >= extent[3])
  )
    return level.selection;
  if (level.query?.bounds.every((value, i) => value === bounds[i])) return level.query.selection;
  const ids: number[] = level.index.search(bounds[0], bounds[1], bounds[2], bounds[3]);
  ids.sort((a, b) => a - b);
  const selection = {
    featureIds: Uint32Array.from(ids, (id) => level.selection.featureIds[id]),
    componentIds: Uint32Array.from(ids, (id) => level.selection.componentIds[id]),
  };
  level.query = { bounds: bounds.slice(), selection };
  return selection;
}

/** Render-only, bounded scale cache. Never writes shapes, records or business masks. */
export class PointLod {
  private entries = new Map<string, Entry>();

  clear(layerId?: string): void {
    if (layerId === undefined) this.entries.clear();
    else this.entries.delete(layerId);
  }

  clearSource(source: string): void {
    for (const [id, entry] of this.entries) if (entry.source === source) this.entries.delete(id);
  }

  /** Drop generated/default layers that disappeared when explicit layers were added. */
  retainLayers(ids: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }

  /** undefined means no valid painted frame yet; null means that frame used full detail. */
  queryPainted(
    spec: CircleLayerSpecification,
    layer: MapshaperLayer,
    dataset: MapshaperDataset | undefined,
    mask: Uint8Array | null,
    bounds: readonly number[],
  ): PointLodSelection | null | undefined {
    const entry = this.entries.get(spec.id);
    if (!entry?.painted || !matches(entry, spec, layer, dataset, mask)) return undefined;
    const { level, bounds: crop } = entry.painted;
    if (!level) return null;
    return queryLevel(level, [
      Math.max(bounds[0], crop[0]),
      Math.max(bounds[1], crop[1]),
      Math.min(bounds[2], crop[2]),
      Math.min(bounds[3], crop[3]),
    ]);
  }

  query(
    spec: CircleLayerSpecification,
    layer: MapshaperLayer,
    dataset: MapshaperDataset | undefined,
    mask: Uint8Array | null,
    transform: AffineTransform,
    bounds: readonly number[],
    view: PointLodView = DEFAULT_VIEW,
  ): PointLodSelection | null {
    if (spec.pointLod === false || layer.geometry_type !== 'point' || !layer.shapes) {
      this.clear(spec.id);
      return null;
    }
    const cellSize = spec.pointLod?.cellSize ?? 8;
    // The binary cell is between half and one requested CSS cell. Allow two
    // viewports of cells, capped by a memory allowance; query bounds never enter it.
    const viewportCells = Math.ceil(
      (Math.max(1, view.width) * Math.max(1, view.height)) / (cellSize / 2) ** 2,
    );
    const budget = Math.min(
      viewportCells * 2,
      MAX_PAINT_REPRESENTATIVES,
      Math.floor(GRID_MEMORY_BUDGET / REPRESENTATIVE_BYTES),
    );
    const scale = Math.max(Math.abs(transform.mx), Math.abs(transform.my));
    const requested = Math.floor(Math.log2(cellSize / scale));
    if (!Number.isFinite(2 ** requested) || 2 ** requested <= 0) return null;
    let entry = this.entries.get(spec.id);
    if (!entry || !matches(entry, spec, layer, dataset, mask) || entry.budget !== budget) {
      entry = {
        source: spec.source,
        dataset,
        layer,
        shapes: layer.shapes,
        count: layer.shapes.length,
        edit: dataset?.editVersion ?? 0,
        attribute: dataset?.attributeVersion ?? 0,
        crs: dataset?.info?.crs,
        mask,
        cellSize,
        budget,
        levels: new Map<number, Level>(),
        bypassBelow: -Infinity,
        budgetFloor: -Infinity,
        small: false,
      };
      this.entries.set(spec.id, entry);
    }
    const finish = (level: Level | null): PointLodSelection | null => {
      if (view.painting) entry.painted = { level, bounds: bounds.slice() };
      return level ? queryLevel(level, bounds) : null;
    };
    if (entry.small || requested <= entry.bypassBelow) return finish(null);
    let exponent = Math.max(requested, entry.budgetFloor);
    let level = entry.levels.get(exponent);
    while (!level) {
      const built = this.build(layer, mask, 2 ** exponent, budget);
      if (built === 'budget') {
        entry.budgetFloor = ++exponent;
        level = entry.levels.get(exponent);
        continue;
      }
      if (built === 'small' || built === 'sparse' || built === 'unsafe') {
        entry.small = built === 'small';
        entry.bypassBelow = Math.max(entry.bypassBelow, exponent);
        return finish(null);
      }
      level = built;
      entry.levels.set(exponent, level);
      if (entry.levels.size > MAX_LEVELS - (entry.local ? 1 : 0))
        entry.levels.delete(entry.levels.keys().next().value!);
    }
    // A global memory limit must not freeze the screen-space detail. Refine the
    // full visible set, not the (possibly tiny) picking rectangle. Local detail
    // stays thinned until the requested cells actually separate original points.
    if (exponent > requested) {
      const candidates = view.getCandidates?.() ?? null;
      if (candidates || view.bounds) {
        return finish(this.refine(entry, layer, mask, requested, candidates, view.bounds));
      }
    }
    entry.levels.delete(exponent);
    entry.levels.set(exponent, level);
    return finish(level);
  }

  private refine(
    entry: Entry,
    layer: MapshaperLayer,
    mask: Uint8Array | null,
    requested: number,
    candidates: Uint32Array | null,
    bounds: readonly number[] | undefined,
  ): Level | null {
    const cached = entry.local;
    const covered =
      cached?.bounds &&
      bounds &&
      !candidates &&
      !cached.candidates &&
      cached.bounds[0] <= bounds[0] &&
      cached.bounds[1] <= bounds[1] &&
      cached.bounds[2] >= bounds[2] &&
      cached.bounds[3] >= bounds[3];
    if (
      cached?.requested === requested &&
      (covered || cached.bounds === bounds || cached.bounds?.every((v, i) => v === bounds?.[i])) &&
      (cached.candidates === candidates ||
        (cached.candidates &&
          candidates &&
          cached.candidates.length === candidates.length &&
          cached.candidates.every((id, i) => id === candidates[i])))
    )
      return cached.level;

    // Chunk queries may return out-of-order or duplicate feature IDs (MultiPoint).
    // Work on a copy so first-original-point selection and drawing order survive.
    const ordered = candidates?.slice().sort() ?? null;
    // A declined broad-phase query needs a source scan. Keep a small overscan
    // margin so adjacent pans can reuse it, rather than rescanning the whole layer.
    const coverage = bounds?.slice();
    if (coverage && !candidates) {
      const padX = Math.min(2 ** requested * 4, (coverage[2] - coverage[0]) / 16);
      const padY = Math.min(2 ** requested * 4, (coverage[3] - coverage[1]) / 16);
      coverage[0] -= padX;
      coverage[2] += padX;
      coverage[1] -= padY;
      coverage[3] += padY;
    }
    let exponent = requested;
    let built = this.build(layer, mask, 2 ** exponent, entry.budget, {
      candidates: ordered,
      bounds: coverage,
    });
    while (built === 'budget')
      built = this.build(layer, mask, 2 ** ++exponent, entry.budget, {
        candidates: ordered,
        bounds: coverage,
      });
    const level = typeof built === 'string' ? null : built;
    entry.local = { requested, candidates, bounds: coverage, level };
    // Include the one local index in the same three-level retention limit.
    while (entry.levels.size >= MAX_LEVELS) entry.levels.delete(entry.levels.keys().next().value!);
    return level;
  }

  private build(
    layer: MapshaperLayer,
    mask: Uint8Array | null,
    cell: number,
    budget: number,
    local?: { candidates: Uint32Array | null; bounds?: readonly number[] },
  ): Level | 'small' | 'sparse' | 'budget' | 'unsafe' {
    if (!Number.isFinite(cell) || cell <= 0) return 'unsafe';
    const columns = new Map<number, Set<number>>();
    const featureIds: number[] = [],
      componentIds: number[] = [],
      xy: number[] = [];
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    let count = 0;
    let sourceCount = 0;
    const candidates = local?.candidates;
    const clip = local?.bounds;
    for (let i = 0, n = candidates?.length ?? layer.shapes!.length; i < n; i++) {
      const id = candidates ? candidates[i] : i;
      if (candidates && i > 0 && id === candidates[i - 1]) continue;
      if (mask && mask[id] !== 1) continue;
      const points = normalizePointShape(layer.shapes![id]);
      for (let component = 0; component < points.length; component++) {
        const p = points[component];
        if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
        sourceCount++;
        if (clip && (p[0] < clip[0] || p[1] < clip[1] || p[0] > clip[2] || p[1] > clip[3]))
          continue;
        count++;
        const x = Math.floor(p[0] / cell),
          y = Math.floor(p[1] / cell);
        if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return 'unsafe';
        let column = columns.get(x);
        if (column?.has(y)) continue;
        if (!column) columns.set(x, (column = new Set()));
        column.add(y);
        featureIds.push(id);
        componentIds.push(component);
        xy.push(p[0], p[1]);
        bounds[0] = Math.min(bounds[0], p[0]);
        bounds[1] = Math.min(bounds[1], p[1]);
        bounds[2] = Math.max(bounds[2], p[0]);
        bounds[3] = Math.max(bounds[3], p[1]);
        if (featureIds.length > budget) return 'budget';
      }
    }
    if (!local && count > 0 && count < MIN_POINTS) return 'small';
    if (!local && count > 0 && featureIds.length >= count * 0.9) return 'sparse';
    // Full detail is safe only when every valid candidate component survived.
    // A small feature count alone says nothing about density or MultiPoint cost.
    if (candidates && sourceCount > 0 && featureIds.length === sourceCount) return 'sparse';
    const index = featureIds.length ? new Flatbush(featureIds.length) : null;
    for (let i = 0; i < xy.length; i += 2) index!.add(xy[i], xy[i + 1], xy[i], xy[i + 1]);
    index?.finish();
    return {
      selection: {
        featureIds: Uint32Array.from(featureIds),
        componentIds: Uint32Array.from(componentIds),
      },
      index,
      bounds,
    };
  }
}

const painterCaches = new WeakMap<object, PointLod>();
export function pointLodForPainter(painter: object): PointLod {
  let cache = painterCaches.get(painter);
  if (!cache) painterCaches.set(painter, (cache = new PointLod()));
  return cache;
}
