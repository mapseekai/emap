import Flatbush from 'flatbush';
import { GluTesselator, gluEnum, windingRule, primitiveType } from 'libtess';

type Contour = ArrayLike<number>;
interface Edge {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  next: number;
}

function orientation(ax: number, ay: number, bx: number, by: number, x: number, y: number): number {
  const p = (bx - ax) * (y - ay),
    q = (by - ay) * (x - ax);
  const d = p - q;
  // Ambiguous near-collinearity takes the general tessellator, never an unsafe fast path.
  return Math.abs(d) <= (Math.abs(p) + Math.abs(q)) * Number.EPSILON * 16 ? 0 : Math.sign(d);
}
function intersects(a: Edge, b: Edge): boolean {
  if (
    Math.max(a.ax, a.bx) < Math.min(b.ax, b.bx) ||
    Math.max(b.ax, b.bx) < Math.min(a.ax, a.bx) ||
    Math.max(a.ay, a.by) < Math.min(b.ay, b.by) ||
    Math.max(b.ay, b.by) < Math.min(a.ay, a.by)
  )
    return false;
  return (
    orientation(a.ax, a.ay, a.bx, a.by, b.ax, b.ay) *
      orientation(a.ax, a.ay, a.bx, a.by, b.bx, b.by) <=
      0 &&
    orientation(b.ax, b.ay, b.bx, b.by, a.ax, a.ay) *
      orientation(b.ax, b.ay, b.bx, b.by, a.bx, a.by) <=
      0
  );
}

/** Earcut expects nonintersecting contours. Detect crossings/touches before ring
 * nesting or zero-signed-area rejection, including intersections between rings.
 * Short building rings avoid an index; complex contours use bounded spatial queries. */
export function intersectingContours(contours: readonly Contour[]): boolean {
  const edges: Edge[] = [];
  for (const xy of contours) {
    const first = edges.length;
    for (let i = 0; i < xy.length; i += 2) {
      const j = (i + 2) % xy.length;
      const ax = xy[i],
        ay = xy[i + 1],
        bx = xy[j],
        by = xy[j + 1];
      if (!Number.isFinite(ax + ay + bx + by) || (ax === bx && ay === by)) continue;
      edges.push({ ax, ay, bx, by, next: edges.length + 1 });
    }
    if (edges.length > first) edges[edges.length - 1].next = first;
  }
  const crossing = (i: number, j: number) =>
    j > i && edges[i].next !== j && edges[j].next !== i && intersects(edges[i], edges[j]);
  if (edges.length < 32) {
    for (let i = 0; i < edges.length; i++)
      for (let j = i + 1; j < edges.length; j++) if (crossing(i, j)) return true;
    return false;
  }
  const index = new Flatbush(edges.length);
  for (const e of edges)
    index.add(
      Math.min(e.ax, e.bx),
      Math.min(e.ay, e.by),
      Math.max(e.ax, e.bx),
      Math.max(e.ay, e.by),
    );
  index.finish();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    for (const j of index.search(
      Math.min(e.ax, e.bx),
      Math.min(e.ay, e.by),
      Math.max(e.ax, e.bx),
      Math.max(e.ay, e.by),
    ))
      if (crossing(i, j)) return true;
  }
  return false;
}

/** Display-only even-odd triangulation. Intersection vertices belong to the mesh,
 * never to the source topology. Translate before GLU to retain small local details. */
export function tessellateEvenOdd(contours: readonly Contour[]): {
  positions: [number, number][];
  indices: number[];
} {
  const positions: [number, number][] = [],
    indices: number[] = [];
  const origin = contours.find((c) => c.length >= 2);
  if (!origin) return { positions, indices };
  const ox = origin[0],
    oy = origin[1];
  const tess = new GluTesselator();
  let error: Error | undefined;
  tess.gluTessNormal(0, 0, 1);
  tess.gluTessProperty(gluEnum.GLU_TESS_WINDING_RULE, windingRule.GLU_TESS_WINDING_ODD);
  tess.gluTessCallback(gluEnum.GLU_TESS_EDGE_FLAG, () => {}); // Emit triangles, not fans/strips.
  tess.gluTessCallback(gluEnum.GLU_TESS_BEGIN, (type: number) => {
    if (type !== primitiveType.GL_TRIANGLES)
      error = new Error('Unexpected polygon tessellation primitive');
  });
  tess.gluTessCallback(gluEnum.GLU_TESS_VERTEX, (id: number) => {
    indices.push(id);
  });
  tess.gluTessCallback(gluEnum.GLU_TESS_COMBINE, (coords: number[]) => {
    positions.push([coords[0] + ox, coords[1] + oy]);
    return positions.length - 1;
  });
  tess.gluTessCallback(gluEnum.GLU_TESS_ERROR, (code: number) => {
    error = new Error(`Polygon tessellation failed (${code})`);
  });
  try {
    tess.gluTessBeginPolygon();
    for (const xy of contours) {
      if (xy.length < 6) continue;
      tess.gluTessBeginContour();
      for (let i = 0; i < xy.length; i += 2) {
        const x = xy[i],
          y = xy[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y))
          throw new Error('Non-finite polygon coordinate');
        const id = positions.length;
        positions.push([x, y]);
        tess.gluTessVertex([x - ox, y - oy, 0], id);
      }
      tess.gluTessEndContour();
    }
    tess.gluTessEndPolygon();
    if (error) throw error;
    return { positions, indices };
  } finally {
    tess.gluDeleteTess();
  }
}
