import type { ArcCollection } from '../types/mapshaper-types';
import { getDefaultMapshaperAdapter } from '../adapter/mapshaper-adapter';

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

  constructor(arcs: ArcCollection) {
    this._unfilteredArcs = arcs;
    const pointCount = arcs.getPointCount?.() ?? 0;
    if (pointCount > LARGE_DATASET_THRESHOLD) {
      this._initFilteredArcs();
    }
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
    // Check for arc count changes (e.g., due to editing)
    if (this._filteredArcs && this._filteredArcs.size() !== this._unfilteredArcs.size()) {
      this._initFilteredArcs();
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
