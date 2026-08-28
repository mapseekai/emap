import type { MapshaperAdapter } from '../../adapter/mapshaper-adapter';
import Flatbush from 'flatbush';
import type { MapshaperDataset, PathShape } from '../../types/mapshaper-types';
import { SplitGeometryValidationError } from './split-selected-error';

const EPSILON = Number.EPSILON * 1024;

export type Coordinate = readonly [number, number];

export function coordinateKey([x, y]: Coordinate): string {
  return `${x},${y}`;
}

export function unsignedArcId(id: number): number {
  return id < 0 ? -id - 1 : id;
}

export function arcEndpoints(
  arcs: NonNullable<MapshaperDataset['arcs']>,
  signedArcId: number,
): [Coordinate, Coordinate] {
  const iterator = arcs.getArcIter(unsignedArcId(signedArcId));
  let first: Coordinate | undefined;
  let last: Coordinate | undefined;
  while (iterator.hasNext()) {
    const coordinate: Coordinate = [iterator.x, iterator.y];
    first ??= coordinate;
    last = coordinate;
  }
  if (!first || !last)
    throw new SplitGeometryValidationError('geometry', 'Encountered an empty path arc');
  return signedArcId < 0 ? [last, first] : [first, last];
}

export function cross(a: Coordinate, b: Coordinate, c: Coordinate): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function orientationTolerance(a: Coordinate, b: Coordinate, c: Coordinate): number {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    acx = c[0] - a[0],
    acy = c[1] - a[1];
  return EPSILON * (Math.abs(abx * acy) + Math.abs(aby * acx));
}

export function segmentIntersection(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): Coordinate | null {
  const abx = b[0] - a[0],
    aby = b[1] - a[1],
    cdx = d[0] - c[0],
    cdy = d[1] - c[1];
  const denominator = abx * cdy - aby * cdx;
  const tolerance = EPSILON * (Math.abs(abx * cdy) + Math.abs(aby * cdx));
  if (Math.abs(denominator) <= tolerance) return null;
  const cax = c[0] - a[0],
    cay = c[1] - a[1];
  const t = (cax * cdy - cay * cdx) / denominator,
    u = (cax * aby - cay * abx) / denominator;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return [a[0] + t * abx, a[1] + t * aby];
}

export function normalizeConsecutiveCoordinates(coordinates: readonly Coordinate[]): Coordinate[] {
  return coordinates.filter(
    (coordinate, index) =>
      index === 0 ||
      coordinate[0] !== coordinates[index - 1]![0] ||
      coordinate[1] !== coordinates[index - 1]![1],
  );
}

export function shapeSegments(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): Array<[Coordinate, Coordinate]> {
  const segments: Array<[Coordinate, Coordinate]> = [];
  for (const part of shape) {
    const points: Coordinate[] = [];
    for (const id of part) {
      const iterator = arcs.getArcIter(unsignedArcId(id));
      const arc: Coordinate[] = [];
      while (iterator.hasNext()) arc.push([iterator.x, iterator.y]);
      if (id < 0) arc.reverse();
      if (!points.length) points.push(...arc);
      else points.push(...arc.slice(1));
    }
    for (let index = 1; index < points.length; index++)
      segments.push([points[index - 1]!, points[index]!]);
  }
  return segments;
}

export function segmentsConflict(
  a: Coordinate,
  b: Coordinate,
  c: Coordinate,
  d: Coordinate,
): boolean {
  if (segmentIntersection(a, b, c, d)) return true;
  if (
    Math.abs(cross(a, b, c)) > orientationTolerance(a, b, c) ||
    Math.abs(cross(a, b, d)) > orientationTolerance(a, b, d)
  )
    return false;
  return (
    [a, b].some(
      (point) =>
        point[0] >= Math.min(c[0], d[0]) - EPSILON &&
        point[0] <= Math.max(c[0], d[0]) + EPSILON &&
        point[1] >= Math.min(c[1], d[1]) - EPSILON &&
        point[1] <= Math.max(c[1], d[1]) + EPSILON,
    ) ||
    [c, d].some(
      (point) =>
        point[0] >= Math.min(a[0], b[0]) - EPSILON &&
        point[0] <= Math.max(a[0], b[0]) + EPSILON &&
        point[1] >= Math.min(a[1], b[1]) - EPSILON &&
        point[1] <= Math.max(a[1], b[1]) + EPSILON,
    )
  );
}

export type SegmentPair = readonly [Coordinate, Coordinate];

/**
 * Flatbush broad-phase over segment AABBs replacing the O(S²) all-pairs
 * `segmentsConflict` scans. Boxes are padded by an EPSILON-scaled segment
 * extent so the exact predicate's parameter slack (t/u ∈ [-ε, 1+ε]) and its
 * absolute containment pad can never fire between segments whose padded boxes
 * do not overlap — filtering is false-negative free and `segmentsConflict`
 * remains the exact final test.
 */
export class SegmentConflictIndex {
  private readonly _segments: SegmentPair[] = [];
  private readonly _ringOf: number[] = [];
  private readonly _positionOf: number[] = [];
  private readonly _ringSizeOf: number[] = [];
  private readonly _index: InstanceType<typeof Flatbush> | null;

  /**
   * @param rings segment lists grouped by ring
   * @param closedRings when true (default), the first/last segment pair of a
   * ring is exempt like adjacent pairs; open polylines pass false.
   * @param options.allowRingTouching when true, segments of *different* rings
   * that merely touch at an isolated point (OGC-tangent contact, e.g. a hole
   * vertex snapped onto the shell) are exempt; proper crossings, collinear
   * overlaps, and vertex contacts where the rings' rays interleave still
   * count as conflicts. Same-ring pairs are always strict.
   */
  constructor(
    rings: ReadonlyArray<ReadonlyArray<SegmentPair>>,
    closedRings = true,
    options: { allowRingTouching?: boolean } = {},
  ) {
    this._allowRingTouching = options.allowRingTouching === true;
    let count = 0;
    for (const ring of rings) count += ring.length;
    this._closedRings = closedRings;
    // Flatbush.finish() throws when nothing was added; empty indexes never search.
    this._index = count === 0 ? null : new Flatbush(count);
    for (let ring = 0; ring < rings.length; ring++) {
      const segments = rings[ring]!;
      for (let position = 0; position < segments.length; position++) {
        const [a, b] = segments[position]!;
        this._segments.push([a, b]);
        this._ringOf.push(ring);
        this._positionOf.push(position);
        this._ringSizeOf.push(segments.length);
        this._index.add(...segmentBox(a, b));
      }
    }
    this._index?.finish();
  }

  private readonly _closedRings: boolean;
  private readonly _allowRingTouching: boolean;

  /**
   * True when any two indexed segments conflict. Adjacent segments of the same
   * ring (plus the closing pair for closed rings) are exempt, matching the
   * exemption rules of the former all-pairs loops.
   */
  hasConflict(): boolean {
    if (!this._index) return false;
    for (let left = 0; left < this._segments.length; left++) {
      const [a, b] = this._segments[left]!;
      for (const right of this._index.search(...segmentBox(a, b))) {
        if (right <= left) continue;
        if (this._ringOf[right] === this._ringOf[left]) {
          const leftPos = this._positionOf[left]!;
          const rightPos = this._positionOf[right]!;
          if (
            rightPos === leftPos + 1 ||
            (this._closedRings && leftPos === 0 && rightPos === this._ringSizeOf[left]! - 1)
          )
            continue;
        }
        const [c, d] = this._segments[right]!;
        if (this._allowRingTouching && this._ringOf[right] !== this._ringOf[left]) {
          if (this._ringsProperlyConflict(left, right)) return true;
        } else if (segmentsConflict(a, b, c, d)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * GEOS/OGC-compatible conflict test for a segment pair from different
   * rings: an isolated point contact (endpoint touching the other segment, or
   * a shared vertex where the rings do not interleave) is *not* a conflict.
   */
  private _ringsProperlyConflict(left: number, right: number): boolean {
    const [a, b] = this._segments[left]!;
    const [c, d] = this._segments[right]!;
    if (!segmentsConflict(a, b, c, d)) return false;
    const hit = segmentIntersection(a, b, c, d);
    if (!hit) return collinearOverlap(a, b, c, d);
    const touchesAB = coincident(hit, a) || coincident(hit, b);
    const touchesCD = coincident(hit, c) || coincident(hit, d);
    if (!touchesAB && !touchesCD) return true;
    if (touchesAB !== touchesCD) return false;
    return this._ringsCrossAtContact(left, hit, right);
  }

  /**
   * Vertex-vertex contact: the rings cross at `point` iff their rays
   * interleave angularly around it; a tangent (non-interleaved) contact is
   * exempt.
   */
  private _ringsCrossAtContact(left: number, point: Coordinate, right: number): boolean {
    const [lu, lv] = this._raysAtContact(left, point);
    const [ru, rv] = this._raysAtContact(right, point);
    const TAU = Math.PI * 2;
    const angle = (q: Coordinate) => Math.atan2(q[1] - point[1], q[0] - point[0]);
    const norm = (x: number) => {
      const wrapped = x % TAU;
      return wrapped < 0 ? wrapped + TAU : wrapped;
    };
    const base = angle(lu);
    const span = norm(angle(lv) - base);
    const toRu = norm(angle(ru) - base);
    const toRv = norm(angle(rv) - base);
    // A ray collinear with one of the left ring's rays grazes — not a cross.
    if (toRu === 0 || toRv === 0 || toRu === span || toRv === span) return false;
    return toRu < span !== toRv < span;
  }

  /** Far endpoints of the two segments of `index`'s ring that meet at `point`. */
  private _raysAtContact(index: number, point: Coordinate): [Coordinate, Coordinate] {
    const position = this._positionOf[index]!;
    const size = this._ringSizeOf[index]!;
    const ringStart = index - position;
    const [a, b] = this._segments[index]!;
    const ownFar = coincident(point, a) ? b : a;
    const neighborIndex =
      ringStart + (coincident(point, a) ? (position - 1 + size) % size : (position + 1) % size);
    const [na, nb] = this._segments[neighborIndex]!;
    const neighborFar = coincident(point, na) ? nb : na;
    return [ownFar, neighborFar];
  }

  /** True when any query segment conflicts with any indexed segment (no exemptions). */
  conflictsWithAny(segments: ReadonlyArray<SegmentPair>): boolean {
    if (!this._index) return false;
    for (const [a, b] of segments) {
      for (const hit of this._index.search(...segmentBox(a, b))) {
        const [c, d] = this._segments[hit]!;
        if (segmentsConflict(a, b, c, d)) return true;
      }
    }
    return false;
  }
}

function segmentBox(a: Coordinate, b: Coordinate): [number, number, number, number] {
  const pad = EPSILON * Math.max(1, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  return [
    Math.min(a[0], b[0]) - pad,
    Math.min(a[1], b[1]) - pad,
    Math.max(a[0], b[0]) + pad,
    Math.max(a[1], b[1]) + pad,
  ];
}

function coincident(p: Coordinate, q: Coordinate): boolean {
  return p[0] === q[0] && p[1] === q[1];
}

/**
 * Positive-length overlap test for the collinear branch of
 * `segmentsConflict` (no crossing point): contact shorter than the
 * parameter-scale tolerance is a touch, not a conflict.
 */
function collinearOverlap(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): boolean {
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  const axis = dx >= dy ? 0 : 1;
  const low = Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
  const high = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]));
  const scale = Math.max(dx, dy, 1);
  return high - low > EPSILON * scale;
}

export function validatePolygonArcReferences(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
): void {
  for (const part of shape) {
    if (!Array.isArray(part) || !part.length)
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    for (const id of part) {
      if (typeof id !== 'number' || !Number.isSafeInteger(id))
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      const arcId = unsignedArcId(id);
      if (!Number.isSafeInteger(arcId) || arcId < 0 || arcId >= arcs.size())
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
      const iterator = arcs.getArcIter(arcId);
      let vertices = 0;
      while (iterator.hasNext()) {
        if (!Number.isFinite(iterator.x) || !Number.isFinite(iterator.y))
          throw new SplitGeometryValidationError(
            'geometry',
            'selected polygon geometry is invalid',
          );
        vertices++;
      }
      if (vertices < 2)
        throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
    }
  }
}

export function validatePolygon(
  shape: PathShape,
  arcs: NonNullable<MapshaperDataset['arcs']>,
  adapter: MapshaperAdapter,
): void {
  if (!shape.length || shape.some((part) => part.length === 0))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const rings = shape.map((part) => shapeSegments([part], arcs));
  for (const segments of rings) {
    if (
      segments.length < 3 ||
      segments[0]![0][0] !== segments.at(-1)![1][0] ||
      segments[0]![0][1] !== segments.at(-1)![1][1]
    )
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  }
  if (new SegmentConflictIndex(rings, true, { allowRingTouching: true }).hasConflict())
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const pathData = adapter.exportPathData(shape, arcs, 'polygon').pathData;
  const anchors = shape.map((part) => adapter.getShapeAnchor([part], arcs));
  if (anchors.some((anchor) => anchor === null))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  const parents = shape.map((_, index) => {
    const anchor = anchors[index]!;
    const candidates = shape.flatMap((ring, candidate) =>
      candidate !== index &&
      Math.abs(pathData[candidate]?.area ?? 0) > Math.abs(pathData[index]?.area ?? 0) &&
      adapter.testPointInRing(anchor[0], anchor[1], ring, arcs) !== 0
        ? [candidate]
        : [],
    );
    return (
      candidates.sort(
        (left, right) => Math.abs(pathData[left]?.area ?? 0) - Math.abs(pathData[right]?.area ?? 0),
      )[0] ?? null
    );
  });
  const depth = (index: number): number =>
    parents[index] === null ? 0 : depth(parents[index]!) + 1;
  for (let index = 0; index < shape.length; index++) {
    const area = pathData[index]?.area ?? 0;
    if (area === 0 || (depth(index) % 2 === 0) !== area > 0)
      throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
  }
  if (!(adapter.getShapeArea(shape, arcs) > 0))
    throw new SplitGeometryValidationError('geometry', 'selected polygon geometry is invalid');
}

export function shoelaceArea(ring: readonly Coordinate[]): number {
  return (
    ring.reduce(
      (area, point, index) =>
        area +
        point[0] * ring[(index + 1) % ring.length]![1] -
        point[1] * ring[(index + 1) % ring.length]![0],
      0,
    ) / 2
  );
}
