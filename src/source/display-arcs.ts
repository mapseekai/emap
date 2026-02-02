import mapshaper from 'mapshaper';

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
  private _unfilteredArcs: any;
  private _filteredArcs: any = null;
  private _filteredSegLen: number = 0;

  constructor(arcs: any) {
    this._unfilteredArcs = arcs;
    const pointCount = arcs.getPointCount();
    if (pointCount > LARGE_DATASET_THRESHOLD) {
      this._initFilteredArcs();
    }
  }

  private _initFilteredArcs(): void {
    const arcs = this._unfilteredArcs;
    const vertexData = arcs.getVertexData();

    if (vertexData.zz) {
      // Use precalculated simplification thresholds (preferred)
      const filterPct = 0.08; // Retain ~8% of points
      const nth = Math.ceil(arcs.getPointCount() / LARGE_DATASET_THRESHOLD);
      const currInterval = arcs.getRetainedInterval();
      const filterZ = arcs.getThresholdByPct(filterPct, nth);
      this._filteredArcs = arcs.setRetainedInterval(filterZ).getFilteredCopy();
      arcs.setRetainedInterval(currInterval); // Reset to original state
      this._filteredSegLen = (mapshaper as any).internal.getAvgSegment(this._filteredArcs);
    } else {
      // Fallback: use fast simplification if no Z values available
      this._filteredSegLen = (mapshaper as any).internal.getAvgSegment(arcs) * 4;
      this._filteredArcs = (mapshaper as any).internal.simplifyArcsFast(arcs, this._filteredSegLen);
    }
  }

  /**
   * Returns the appropriate arc collection based on current zoom level.
   * @param unitsPerPixel - Map units per screen pixel (1 / transform.mx)
   * @returns Low-detail arcs when zoomed out, full-detail arcs when zoomed in
   */
  getScaledArcs(unitsPerPixel: number): any {
    // Check for arc count changes (e.g., due to editing)
    if (this._filteredArcs && this._filteredArcs.size() !== this._unfilteredArcs.size()) {
      this._initFilteredArcs();
    }

    // Sync simplification interval with the unfiltered arcs
    if (this._filteredArcs) {
      this._filteredArcs.setRetainedInterval(this._unfilteredArcs.getRetainedInterval());
    }

    // Switch to filtered version at small scales
    const useFiltered = this._filteredArcs && unitsPerPixel > this._filteredSegLen * 1.5;
    return useFiltered ? this._filteredArcs : this._unfilteredArcs;
  }

  /**
   * Returns the original (full-detail) arc collection.
   */
  getArcs(): any {
    return this._unfilteredArcs;
  }

  /**
   * Returns true if a low-detail LOD copy exists.
   */
  hasLOD(): boolean {
    return this._filteredArcs !== null;
  }
}
