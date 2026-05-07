import type { EditCommand } from '../edit-command';
import type { ArcCollection } from '../../types/mapshaper-types';
import type { TopologySource } from '../../source/source';
import type { TranslatedPointFeature } from './feature-translate';
import { normalizePointShape } from '../../source/layer-utils';

/**
 * 2x3 affine matrix in SVG/Canvas convention.
 *
 *   x' = a*x + c*y + tx
 *   y' = b*x + d*y + ty
 */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface FeatureAffineCommandOptions {
  source: TopologySource;
  /** Shared ArcCollection for path features. Omit for point-only commands. */
  arcs?: ArcCollection;
  /** Forward matrix. `do()` applies it; `undo()` applies its inverse. */
  matrix: AffineMatrix;
  /** Unique abs-arc-ids referenced by selected path features. */
  arcIds: number[];
  /** Selected point features. */
  pointFeatures: TranslatedPointFeature[];
  /** Optional human-readable label (defaults to `Transform N features`). */
  label?: string;
}

/**
 * Apply an affine transform to a fixed set of arcs and point shapes,
 * reversing it on undo via the analytically-computed inverse matrix.
 *
 * Same lightweight in-place semantics as `FeatureTranslateCommand`:
 * O(touched-vertices), composes freely with other commands in one undo
 * timeline, no dataset replacement, selection survives.
 */
export class FeatureAffineCommand implements EditCommand {
  readonly label: string;

  constructor(private readonly opts: FeatureAffineCommandOptions) {
    const n = opts.arcIds.length + opts.pointFeatures.length;
    this.label = opts.label ?? `Transform ${n} feature${n === 1 ? '' : 's'}`;
  }

  do(): void {
    this._apply(this.opts.matrix);
  }

  undo(): void {
    this._apply(invertMatrix(this.opts.matrix));
  }

  private _apply(m: AffineMatrix): void {
    const { arcs, arcIds, pointFeatures, source } = this.opts;

    if (arcs && arcIds.length > 0) {
      const data = arcs.getVertexData?.();
      if (data) {
        const { xx, yy, ii, nn } = data;
        for (const arcId of arcIds) {
          const start = ii[arcId];
          const len = nn[arcId];
          for (let i = start; i < start + len; i++) {
            const x = xx[i];
            const y = yy[i];
            xx[i] = m.a * x + m.c * y + m.tx;
            yy[i] = m.b * x + m.d * y + m.ty;
          }
          arcs.updateArcBounds?.(arcId);
        }
      }
    }

    for (const pf of pointFeatures) {
      const shape = pf.layer.shapes?.[pf.featureId];
      if (!shape) continue;
      // See `feature-translate.ts` for why `normalizePointShape` preserves
      // mutability across the legacy single-coord shape.
      for (const coord of normalizePointShape(shape)) {
        if (coord && coord.length >= 2) {
          const x = coord[0];
          const y = coord[1];
          coord[0] = m.a * x + m.c * y + m.tx;
          coord[1] = m.b * x + m.d * y + m.ty;
        }
      }
    }

    source.markDisplayArcsDirty?.();
  }
}

// ---------------------------------------------------------------------------
// Matrix helpers
// ---------------------------------------------------------------------------

/**
 * Rotate around `(ox, oy)` by `angleRad`.
 *
 * Combined transform: translate(-ox,-oy) → rotate(θ) → translate(ox,oy).
 */
export function rotateMatrix(angleRad: number, ox = 0, oy = 0): AffineMatrix {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    tx: ox - cos * ox + sin * oy,
    ty: oy - sin * ox - cos * oy,
  };
}

/**
 * Scale by `(sx, sy)` around `(ox, oy)`.
 *
 * Combined transform: translate(-ox,-oy) → scale(sx,sy) → translate(ox,oy).
 */
export function scaleMatrix(sx: number, sy: number, ox = 0, oy = 0): AffineMatrix {
  return {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    tx: ox - sx * ox,
    ty: oy - sy * oy,
  };
}

/**
 * Compose two matrices: result applies `b` first, then `a`. I.e. for vertex
 * `v`, `compose(a, b)` is equivalent to `a * b * v` — the same convention
 * as DOMMatrix and CSS `transform`.
 */
export function composeMatrix(a: AffineMatrix, b: AffineMatrix): AffineMatrix {
  return {
    a: a.a * b.a + a.c * b.b,
    b: a.b * b.a + a.d * b.b,
    c: a.a * b.c + a.c * b.d,
    d: a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

/** Identity matrix — useful as the starting cumulative for `composeMatrix`. */
export const IDENTITY_MATRIX: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };

/**
 * Analytical inverse. For a non-degenerate `m`, applying `m` then
 * `invertMatrix(m)` is the identity (within floating-point epsilon).
 */
export function invertMatrix(m: AffineMatrix): AffineMatrix {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) {
    throw new Error('FeatureAffineCommand: matrix is singular (det=0)');
  }
  const invA = m.d / det;
  const invB = -m.b / det;
  const invC = -m.c / det;
  const invD = m.a / det;
  return {
    a: invA,
    b: invB,
    c: invC,
    d: invD,
    tx: -(invA * m.tx + invC * m.ty),
    ty: -(invB * m.tx + invD * m.ty),
  };
}
