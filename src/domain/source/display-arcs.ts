import type { ArcCollection } from '../../shared/types/mapshaper-types';
import { getDefaultMapshaperAdapter } from '../../integrations/mapshaper/adapter';
import { prepareDisplayLod } from '../../integrations/mapshaper/display-lod';

/** Threshold for generating low-detail arcs (500k points) */
const LARGE_DATASET_THRESHOLD = 5e5;

/**
 * Wraps a Mapshaper ArcCollection and provides Level of Detail (LOD) switching.
 * For large datasets (>500k points), generates a low-detail copy for faster
 * rendering at zoomed-out scales.
 *
 * Based on Mapshaper's gui-display-arcs.mjs implementation.
 */
export class DisplayArcs {
  private _unfilteredArcs: ArcCollection;
  private _filteredArcs: ArcCollection | null = null;
  private _filteredSegLen = 0;
  /**
   * Set by {@link markDirty} when an in-place edit (translate / vertex move /
   * shared-arc split / …) mutates the underlying arcs. Cleared the next time
   * {@link getScaledArcs} actually needs the filtered copy and rebuilds it.
   *
   * The flag lets per-frame edit sessions defer the (~O(N)) filtered-copy
   * rebuild until the renderer asks for it. Most drags happen at zoom levels
   * where the unfiltered arcs are used directly, so the rebuild often fires
   * exactly once — at the next zoom-out.
   */
  private _dirty = false;
  private _controller: AbortController | null = null;
  private _ready: Promise<void> = Promise.resolve();
  private _disposed = false;

  constructor(
    arcs: ArcCollection,
    private readonly onReady?: () => void,
    private readonly onError?: (error: unknown) => void,
  ) {
    this._unfilteredArcs = arcs;
    const pointCount = arcs.getPointCount?.() ?? 0;
    if (pointCount > LARGE_DATASET_THRESHOLD) {
      if (onReady) this._prepare();
      else this._initFilteredArcs();
    }
  }

  /**
   * Mark the cached LOD copy stale. Cheap (O(1) flag flip) so callers
   * inside per-frame drag loops can safely invoke this on every step;
   * the actual rebuild happens lazily inside {@link getScaledArcs}.
   *
   * For datasets below `LARGE_DATASET_THRESHOLD` (no LOD copy ever
   * created), this is effectively a no-op.
   */
  markDirty(): void {
    this._controller?.abort();
    if (this.onReady) this._filteredArcs = null;
    this._dirty = true;
  }

  /** Settles the current preparation; superseded results never publish. */
  get ready(): Promise<void> {
    return this._ready;
  }

  private _prepare(): void {
    this._controller?.abort();
    const controller = (this._controller = new AbortController());
    this._dirty = false;
    this._ready = prepareDisplayLod(this._unfilteredArcs, controller.signal)
      .then((result) => {
        if (controller.signal.aborted || this._disposed) return;
        this._filteredArcs = result.arcs;
        this._filteredSegLen = result.segmentLength;
        this.onReady?.();
      })
      .catch((error) => {
        if (!controller.signal.aborted && !this._disposed) this.onError?.(error);
      });
  }

  dispose(): void {
    this._disposed = true;
    this._controller?.abort();
    this._filteredArcs = null;
  }

  private _initFilteredArcs(): void {
    const arcs = this._unfilteredArcs;
    const vertexData = arcs.getVertexData?.();

    if (vertexData?.zz) {
      // Use precalculated simplification thresholds (preferred)
      const filterPct = 0.08; // Retain ~8% of points
      const nth = Math.ceil((arcs.getPointCount?.() ?? 0) / LARGE_DATASET_THRESHOLD);
      const currInterval = arcs.getRetainedInterval?.() ?? 0;
      const filterZ = arcs.getThresholdByPct?.(filterPct, nth) ?? 0;
      this._filteredArcs = arcs.setRetainedInterval?.(filterZ)?.getFilteredCopy?.() ?? null;
      arcs.setRetainedInterval?.(currInterval); // Reset to original state
      if (this._filteredArcs) {
        this._filteredSegLen = getDefaultMapshaperAdapter().getAvgSegment(this._filteredArcs);
      }
    } else {
      // Fallback: use fast simplification if no Z values available
      const adapter = getDefaultMapshaperAdapter();
      this._filteredSegLen = adapter.getAvgSegment(arcs) * 4;
      this._filteredArcs = adapter.simplifyArcsFast(arcs, this._filteredSegLen);
    }
  }

  /**
   * Returns the appropriate arc collection based on current zoom level.
   * @param unitsPerPixel - Map units per screen pixel (1 / transform.mx)
   * @returns Low-detail arcs when zoomed out, full-detail arcs when zoomed in
   */
  getScaledArcs(unitsPerPixel: number): ArcCollection {
    if (this.onReady) {
      if (this._filteredArcs && this._filteredArcs.size() !== this._unfilteredArcs.size())
        this.markDirty();
      if (
        !this._disposed &&
        this._dirty &&
        (this._unfilteredArcs.getPointCount?.() ?? 0) > LARGE_DATASET_THRESHOLD &&
        unitsPerPixel > this._filteredSegLen * 1.5
      )
        this._prepare();
      this._filteredArcs?.setRetainedInterval?.(this._unfilteredArcs.getRetainedInterval?.() ?? 0);
      return this._filteredArcs && unitsPerPixel > this._filteredSegLen * 1.5
        ? this._filteredArcs
        : this._unfilteredArcs;
    }
    // Decide whether the filtered copy is even relevant at this zoom.
    // When it isn't, postpone any rebuild — saves the O(N) work for
    // drags that stay zoomed in.
    const wantFiltered = this._filteredArcs !== null && unitsPerPixel > this._filteredSegLen * 1.5;

    // Rebuild conditions:
    //   1. Arc count changed since last LOD build (e.g. shared-arc split).
    //   2. `markDirty()` was called and the filtered copy is needed now.
    if (this._filteredArcs) {
      const arcCountChanged = this._filteredArcs.size() !== this._unfilteredArcs.size();
      if (arcCountChanged || (this._dirty && wantFiltered)) {
        this._initFilteredArcs();
        this._dirty = false;
      }
    } else if (this._dirty) {
      // No LOD copy yet but caller marked dirty — only matters once the
      // dataset crosses the LARGE_DATASET_THRESHOLD via append. Re-check.
      const pointCount = this._unfilteredArcs.getPointCount?.() ?? 0;
      if (pointCount > LARGE_DATASET_THRESHOLD) {
        this._initFilteredArcs();
      }
      this._dirty = false;
    }

    // Sync simplification interval with the unfiltered arcs
    if (this._filteredArcs) {
      this._filteredArcs.setRetainedInterval?.(this._unfilteredArcs.getRetainedInterval?.() ?? 0);
    }

    // Switch to filtered version at small scales
    const useFiltered = this._filteredArcs && unitsPerPixel > this._filteredSegLen * 1.5;
    return useFiltered ? this._filteredArcs! : this._unfilteredArcs;
  }

  /**
   * Returns the original (full-detail) arc collection.
   */
  getArcs(): ArcCollection {
    return this._unfilteredArcs;
  }

  /**
   * Returns true if a low-detail LOD copy exists.
   */
  hasLOD(): boolean {
    return this._filteredArcs !== null;
  }
}
