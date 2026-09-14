import Flatbush from 'flatbush';
import {
  getDefaultMapshaperAdapter,
  type ExportedPath,
  type MapshaperAdapter,
} from '../mapshaper/adapter';
import type { ArcCollection } from '../../shared/types/mapshaper-types';

/**
 * Group polygon rings into shell + holes per output polygon part.
 *
 * Port of mapshaper's internal `groupPolygonRings()` (mapshaper is MPL-2.0,
 * same as emap; the function is not exported through `mapshaper.internal`).
 * Differences from the original: bbox candidate search uses emap's existing
 * `flatbush` dependency instead of mapshaper's internal bounds index, and
 * the precise containment test goes through the adapter's `testPointInRing`.
 *
 * Input paths come from `adapter.exportPathData()`: shells have positive
 * `area`, holes negative (mapshaper's planar winding convention). Each
 * hole is assigned to the smallest shell that contains it; orphan holes
 * are dropped with a debug-level skip, matching mapshaper.
 */
export function groupPolygonRings(
  paths: ExportedPath[],
  arcs: ArcCollection,
  adapter: MapshaperAdapter = getDefaultMapshaperAdapter(),
): ExportedPath[][] {
  const groups: ExportedPath[][] = [];
  const holes: ExportedPath[] = [];

  for (const path of paths) {
    const area = path.area ?? 0;
    if (area > 0) {
      groups.push([path]);
    } else if (area < 0) {
      holes.push(path);
    }
    // zero-area rings are dropped (exportPathData already filters most)
  }

  if (holes.length === 0 || groups.length === 0) {
    return groups;
  }

  const index = new Flatbush(groups.length);
  for (const group of groups) {
    const b = group[0].bounds!;
    index.add(b.xmin, b.ymin, b.xmax, b.ymax);
  }
  index.finish();

  for (const hole of holes) {
    const hb = hole.bounds!;
    const holeArea = -(hole.area ?? 0);
    const candidates = index.search(hb.xmin, hb.ymin, hb.xmax, hb.ymax);
    let containerId = -1;
    let containerArea = 0;

    for (const ringId of candidates) {
      const ring = groups[ringId][0];
      const rb = ring.bounds!;
      const ringArea = ring.area ?? 0;
      const boundsContain =
        rb.xmin <= hb.xmin && rb.ymin <= hb.ymin && rb.xmax >= hb.xmax && rb.ymax >= hb.ymax;
      const isContained = boundsContain && ringArea > holeArea;
      if (!isContained) continue;
      // Like mapshaper: when several rings' bboxes contain the hole, run the
      // precise point-in-ring test (midpoint of the hole's first segment, to
      // dodge a shared first vertex).
      if (candidates.length > 1 && !testRingInRing(hole, ring, arcs, adapter)) {
        continue;
      }
      if (containerArea === 0 || ringArea < containerArea) {
        containerArea = ringArea;
        containerId = ringId;
      }
    }

    if (containerId !== -1) {
      groups[containerId].push(hole);
    }
  }

  return groups;
}

function testRingInRing(
  hole: ExportedPath,
  ring: ExportedPath,
  arcs: ArcCollection,
  adapter: MapshaperAdapter,
): boolean {
  if (!ring.ids || hole.points.length < 2) return true;
  const p1 = hole.points[0];
  const p2 = hole.points[1];
  const mx = (p1[0] + p2[0]) / 2;
  const my = (p1[1] + p2[1]) / 2;
  return adapter.testPointInRing(mx, my, ring.ids, arcs) === 1;
}
