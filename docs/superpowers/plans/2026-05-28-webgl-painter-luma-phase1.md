# WebGL Painter luma.gl Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional luma.gl-backed `WebGLPainter` that implements the existing `Painter` interface while keeping Canvas 2D as the default renderer.

**Architecture:** Keep `Emap` painter-agnostic by introducing a small renderer option and factory. `ArcCollection` stays the source of truth; WebGL receives derived typed arrays through focused conversion helpers. Phase 1 uses emap's own canvas and defers MapLibre Custom Layer context sharing, cache benchmarks, and depth-buffer multi-layer interleaving.

**Tech Stack:** TypeScript, Vitest, luma.gl (`@luma.gl/core`, `@luma.gl/engine`, `@luma.gl/webgl`), Mapshaper `ArcCollection`, existing `AffineTransform` and `Painter` interfaces.

---

## File Structure

- Create `src/renderer/painter-factory.ts`: selects Canvas or WebGL and owns fallback behavior.
- Create `src/renderer/painter-factory.test.ts`: verifies default Canvas behavior and fallback behavior without requiring a real WebGL context.
- Create `src/renderer/webgl/geometry.ts`: pure typed-array conversion helpers for arcs, points, polygon rings, and overlay primitives.
- Create `src/renderer/webgl/geometry.test.ts`: unit tests for conversion, reversed arcs, filters, and point normalization.
- Create `src/renderer/webgl/style.ts`: color parsing and pixel-ratio style normalization for shader uniforms.
- Create `src/renderer/webgl/style.test.ts`: unit tests for rgba/hex parsing, opacity multiplication, and size scaling.
- Create `src/renderer/webgl-painter.ts`: luma.gl-backed `Painter` implementation.
- Create `src/renderer/webgl-painter.test.ts`: constructor/fallback and method-level smoke tests with mocked luma model creation.
- Modify `src/map/types.ts`: add `RendererType` and `MapOptions.renderer`.
- Modify `src/map/map.ts`: replace direct `CanvasPainter` construction with `createPainter`.
- Modify `src/index.ts`: export `WebGLPainter`, `RendererType`, and factory types.
- Modify `README.md`: document `renderer: 'canvas' | 'webgl' | 'auto'`, fallback behavior, and Phase 1 limits.
- Modify `package.json`, `package-lock.json`, `pnpm-lock.yaml`: add luma.gl dependencies.
- Modify `rollup.config.mjs`: externalize luma.gl packages for ESM and keep IIFE behavior explicit.

Do not touch existing basemap/camera files except where `src/map/map.ts` imports are adjusted for the painter factory. The current branch has unrelated basemap/camera edits; commits for this plan must stage only the paths listed in each task.

---

### Task 1: Add luma.gl Dependencies and Bundle Rules

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `pnpm-lock.yaml`
- Modify: `rollup.config.mjs`

- [ ] **Step 1: Install luma packages**

Run:

```bash
npm install @luma.gl/core @luma.gl/engine @luma.gl/webgl
```

Expected: `package.json`, `package-lock.json`, and possibly `pnpm-lock.yaml` show the three luma packages under dependencies.

- [ ] **Step 2: Sync pnpm lockfile**

Run:

```bash
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records the same package versions as `package-lock.json`.

- [ ] **Step 3: Externalize luma packages in the ESM bundle**

In `rollup.config.mjs`, add:

```js
const lumaExternals = [
  '@luma.gl/core',
  '@luma.gl/engine',
  '@luma.gl/webgl',
];
```

Then extend the browser ESM bundle external list:

```js
external: ['maplibre-gl', 'mapshaper', ...lumaExternals],
```

Leave the IIFE bundle decision explicit in a comment near the main IIFE output:

```js
// luma.gl is bundled into the IIFE build so script-tag users do not need
// separate luma globals when opting into renderer: 'webgl'.
```

- [ ] **Step 4: Verify dependency metadata**

Run:

```bash
npm run typecheck
```

Expected: PASS. If it fails because luma type packages require a newer lib target, update `tsconfig.json` only with the minimum browser lib needed and record that in the commit message.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json package-lock.json pnpm-lock.yaml rollup.config.mjs
git commit -m "Add luma dependencies for optional WebGL rendering" \
  -m "The WebGL painter needs luma's Device, Model, and Geometry abstractions while Canvas remains the default renderer." \
  -m "Constraint: Keep ESM luma packages external so bundler consumers can dedupe them" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: npm run typecheck"
```

---

### Task 2: Add Renderer Option and Painter Factory

**Files:**
- Create: `src/renderer/painter-factory.test.ts`
- Create: `src/renderer/painter-factory.ts`
- Modify: `src/map/types.ts`
- Modify: `src/map/map.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing factory tests**

Create `src/renderer/painter-factory.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Painter } from './painter';
import { createPainter } from './painter-factory';

class FakeCanvasPainter implements Painter {
  constructor(public canvas: HTMLCanvasElement) {}
  drawPaths() {}
  drawArcs() {}
  drawPoints() {}
  drawPolygonFill() {}
  drawVertexDots() {}
  drawDrawingOverlay() {}
  clear() {}
  resize() {}
  setTransform() {}
  setPixelRatio() {}
}

class FakeWebGLPainter extends FakeCanvasPainter {}

function makeCanvas() {
  return { getContext: vi.fn(() => ({})), style: {} } as unknown as HTMLCanvasElement;
}

describe('createPainter', () => {
  it('uses CanvasPainter by default', () => {
    const result = createPainter(makeCanvas(), {}, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: FakeWebGLPainter,
      warn: vi.fn(),
    });

    expect(result.painter).toBeInstanceOf(FakeCanvasPainter);
    expect(result.renderer).toBe('canvas');
    expect(result.requestedRenderer).toBe('canvas');
  });

  it('uses WebGLPainter when requested and construction succeeds', () => {
    const result = createPainter(makeCanvas(), { renderer: 'webgl' }, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: FakeWebGLPainter,
      warn: vi.fn(),
    });

    expect(result.painter).toBeInstanceOf(FakeWebGLPainter);
    expect(result.renderer).toBe('webgl');
    expect(result.requestedRenderer).toBe('webgl');
  });

  it('falls back to CanvasPainter when WebGL construction fails', () => {
    const warn = vi.fn();
    class BrokenWebGLPainter extends FakeCanvasPainter {
      constructor(canvas: HTMLCanvasElement) {
        super(canvas);
        throw new Error('no webgl');
      }
    }

    const result = createPainter(makeCanvas(), { renderer: 'auto' }, {
      CanvasPainter: FakeCanvasPainter,
      WebGLPainter: BrokenWebGLPainter,
      warn,
    });

    expect(result.painter).toBeInstanceOf(FakeCanvasPainter);
    expect(result.renderer).toBe('canvas');
    expect(result.requestedRenderer).toBe('auto');
    expect(warn).toHaveBeenCalledWith(
      'emap: WebGL renderer unavailable, falling back to Canvas 2D',
      expect.any(Error),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm run test:run -- src/renderer/painter-factory.test.ts
```

Expected: FAIL because `painter-factory.ts` and `RendererType` do not exist yet.

- [ ] **Step 3: Add renderer types**

In `src/map/types.ts`, add near render types:

```ts
export type RendererType = 'canvas' | 'webgl' | 'auto';
```

Then add to `MapOptions`:

```ts
  /**
   * Rendering backend. Defaults to `'canvas'`.
   *
   * - `'canvas'` uses the established Canvas 2D renderer.
   * - `'webgl'` attempts the luma.gl renderer and falls back to Canvas if
   *   WebGL initialization fails.
   * - `'auto'` currently attempts WebGL first, then falls back to Canvas.
   */
  renderer?: RendererType;
```

- [ ] **Step 4: Implement the factory**

Create `src/renderer/painter-factory.ts`:

```ts
import { CanvasPainter } from './canvas-painter';
import { WebGLPainter } from './webgl-painter';
import type { Painter } from './painter';
import type { RendererType } from '../map/types';

export interface PainterFactoryOptions {
  renderer?: RendererType;
}

export interface PainterFactoryResult {
  painter: Painter;
  renderer: Exclude<RendererType, 'auto'>;
  requestedRenderer: RendererType;
}

interface PainterConstructors {
  CanvasPainter: new (canvas: HTMLCanvasElement) => Painter;
  WebGLPainter: new (canvas: HTMLCanvasElement) => Painter;
  warn: (message: string, error: unknown) => void;
}

const DEFAULT_CONSTRUCTORS: PainterConstructors = {
  CanvasPainter,
  WebGLPainter,
  warn: (message, error) => console.warn(message, error),
};

export function createPainter(
  canvas: HTMLCanvasElement,
  options: PainterFactoryOptions = {},
  constructors: PainterConstructors = DEFAULT_CONSTRUCTORS,
): PainterFactoryResult {
  const requestedRenderer = options.renderer ?? 'canvas';
  if (requestedRenderer === 'canvas') {
    return {
      painter: new constructors.CanvasPainter(canvas),
      renderer: 'canvas',
      requestedRenderer,
    };
  }

  try {
    return {
      painter: new constructors.WebGLPainter(canvas),
      renderer: 'webgl',
      requestedRenderer,
    };
  } catch (error) {
    constructors.warn(
      'emap: WebGL renderer unavailable, falling back to Canvas 2D',
      error,
    );
    return {
      painter: new constructors.CanvasPainter(canvas),
      renderer: 'canvas',
      requestedRenderer,
    };
  }
}
```

- [ ] **Step 5: Wire `Emap` to the factory**

In `src/map/map.ts`, replace:

```ts
import { CanvasPainter } from '../renderer/canvas-painter';
```

with:

```ts
import { createPainter } from '../renderer/painter-factory';
```

Replace constructor painter creation:

```ts
    this._painter = new CanvasPainter(this._canvas);
```

with:

```ts
    this._painter = createPainter(this._canvas, {
      renderer: options.renderer,
    }).painter;
```

Keep the existing `setPixelRatio` and `EditOverlayRenderer` lines unchanged.

- [ ] **Step 6: Export the public types**

In `src/index.ts`, add:

```ts
export { WebGLPainter } from './renderer/webgl-painter';
export { createPainter } from './renderer/painter-factory';
export type {
  PainterFactoryOptions,
  PainterFactoryResult,
} from './renderer/painter-factory';
export type { RendererType } from './map/types';
```

- [ ] **Step 7: Run focused verification**

Run:

```bash
npm run test:run -- src/renderer/painter-factory.test.ts
npm run typecheck
```

Expected: both PASS after `WebGLPainter` exists in Task 5. Before Task 5, typecheck may fail on the missing class; do not commit this task until Task 5 creates the class.

---

### Task 3: Add WebGL Style Helpers

**Files:**
- Create: `src/renderer/webgl/style.test.ts`
- Create: `src/renderer/webgl/style.ts`

- [ ] **Step 1: Write failing tests**

Create `src/renderer/webgl/style.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseColor,
  resolvePointUniforms,
  resolveStrokeUniforms,
} from './style';

describe('webgl style helpers', () => {
  it('parses hex colors into normalized premultiplied rgba', () => {
    expect(parseColor('#336699')).toEqual([
      0x33 / 255,
      0x66 / 255,
      0x99 / 255,
      1,
    ]);
  });

  it('parses rgba colors and multiplies opacity', () => {
    const color = parseColor('rgba(100, 50, 25, 0.8)', 0.5);
    expect(color[0]).toBeCloseTo(100 / 255);
    expect(color[1]).toBeCloseTo(50 / 255);
    expect(color[2]).toBeCloseTo(25 / 255);
    expect(color[3]).toBeCloseTo(0.4);
  });

  it('scales stroke width and point radius by pixel ratio', () => {
    expect(resolveStrokeUniforms({ color: '#000', width: 2 }, 3)).toEqual({
      color: [0, 0, 0, 1],
      width: 6,
    });
    expect(resolvePointUniforms({ color: '#000', radius: 4 }, 2)).toEqual({
      color: [0, 0, 0, 1],
      radius: 8,
      fill: true,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm run test:run -- src/renderer/webgl/style.test.ts
```

Expected: FAIL because `style.ts` does not exist.

- [ ] **Step 3: Implement style helpers**

Create `src/renderer/webgl/style.ts`:

```ts
import type { PointStyle, StrokeStyle } from '../../types/mapshaper-types';

export type Rgba = [number, number, number, number];

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function parseColor(input: string | undefined, opacity = 1): Rgba {
  const color = (input || '#333').trim().toLowerCase();
  const normalized = NAMED_COLORS[color] || color;
  const alphaScale = clamp01(opacity);

  if (normalized.startsWith('#')) {
    const hex = normalized.slice(1);
    const full = hex.length === 3
      ? hex.split('').map(c => c + c).join('')
      : hex;
    const int = Number.parseInt(full.slice(0, 6), 16);
    return [
      ((int >> 16) & 255) / 255,
      ((int >> 8) & 255) / 255,
      (int & 255) / 255,
      alphaScale,
    ];
  }

  const rgba = normalized.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map(part => Number(part.trim()));
    return [
      clamp01(parts[0] / 255),
      clamp01(parts[1] / 255),
      clamp01(parts[2] / 255),
      clamp01((Number.isFinite(parts[3]) ? parts[3] : 1) * alphaScale),
    ];
  }

  return parseColor('#333', opacity);
}

export function resolveStrokeUniforms(style: StrokeStyle, pixelRatio: number) {
  return {
    color: parseColor(style.color),
    width: (style.width ?? 1) * pixelRatio,
  };
}

export function resolvePointUniforms(style: PointStyle, pixelRatio: number) {
  return {
    color: parseColor(style.color),
    radius: (Number(style.radius) || 4) * pixelRatio,
    fill: style.fill !== false,
  };
}
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
npm run test:run -- src/renderer/webgl/style.test.ts
```

Expected: PASS.

---

### Task 4: Add Pure Geometry Conversion Helpers

**Files:**
- Create: `src/renderer/webgl/geometry.test.ts`
- Create: `src/renderer/webgl/geometry.ts`

- [ ] **Step 1: Write failing conversion tests**

Create `src/renderer/webgl/geometry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildArcLineGeometry,
  buildPointGeometry,
  buildPolygonRingGeometry,
} from './geometry';

function makeArcIter(points: Array<[number, number]>) {
  let i = -1;
  return {
    x: 0,
    y: 0,
    hasNext() {
      i++;
      const p = points[i];
      if (!p) return false;
      this.x = p[0];
      this.y = p[1];
      return true;
    },
  };
}

function makeArcs() {
  const arcPoints = [
    [[0, 0], [1, 0], [1, 1]],
    [[2, 2], [3, 2]],
  ] as Array<Array<[number, number]>>;

  return {
    size: () => arcPoints.length,
    getArcIter: (arcId: number) => makeArcIter(arcPoints[arcId >= 0 ? arcId : ~arcId]),
    getShapeIter: (part: number[]) => {
      const points: Array<[number, number]> = [];
      for (const arcId of part) {
        const arc = arcPoints[arcId >= 0 ? arcId : ~arcId];
        points.push(...(arcId >= 0 ? arc : [...arc].reverse()));
      }
      return makeArcIter(points);
    },
  };
}

describe('webgl geometry helpers', () => {
  it('builds line-list vertices from filtered arcs', () => {
    const geometry = buildArcLineGeometry(makeArcs() as any, i => i === 0);
    expect(Array.from(geometry.positions)).toEqual([
      0, 0, 1, 0,
      1, 0, 1, 1,
    ]);
    expect(geometry.vertexCount).toBe(4);
  });

  it('normalizes point shapes into positions', () => {
    const geometry = buildPointGeometry([[[4, 5], [6, 7]], [8, 9]]);
    expect(Array.from(geometry.positions)).toEqual([4, 5, 6, 7, 8, 9]);
    expect(geometry.vertexCount).toBe(3);
  });

  it('uses shape iterator so reversed polygon arcs are respected', () => {
    const geometry = buildPolygonRingGeometry([[[~0]]], makeArcs() as any);
    expect(Array.from(geometry.positions)).toEqual([1, 1, 1, 0, 0, 0]);
    expect(geometry.ringStarts).toEqual([0]);
    expect(geometry.ringCounts).toEqual([3]);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts
```

Expected: FAIL because `geometry.ts` does not exist.

- [ ] **Step 3: Implement geometry helpers**

Create `src/renderer/webgl/geometry.ts`:

```ts
import { normalizePointShape } from '../../source/layer-utils';
import type { ArcCollection } from '../../types/mapshaper-types';

export interface WebGLPositionGeometry {
  positions: Float32Array;
  vertexCount: number;
}

export interface WebGLPolygonRingGeometry extends WebGLPositionGeometry {
  ringStarts: number[];
  ringCounts: number[];
}

export function buildArcLineGeometry(
  arcs: ArcCollection,
  filter?: (i: number) => boolean,
): WebGLPositionGeometry {
  const coords: number[] = [];
  for (let arcId = 0; arcId < arcs.size(); arcId++) {
    if (filter && !filter(arcId)) continue;
    const iter = arcs.getArcIter(arcId);
    let prev: [number, number] | null = null;
    while (iter.hasNext()) {
      const curr: [number, number] = [iter.x, iter.y];
      if (prev) coords.push(prev[0], prev[1], curr[0], curr[1]);
      prev = curr;
    }
  }
  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
  };
}

export function buildPointGeometry(shapes: any[]): WebGLPositionGeometry {
  const coords: number[] = [];
  for (const shape of shapes) {
    if (!shape) continue;
    const points = normalizePointShape(shape);
    for (const point of points) {
      coords.push(point[0], point[1]);
    }
  }
  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
  };
}

export function buildPolygonRingGeometry(
  shapes: any[],
  arcs: ArcCollection & { getShapeIter?: (part: number[]) => { x: number; y: number; hasNext(): boolean } },
  filter?: (i: number) => boolean,
): WebGLPolygonRingGeometry {
  const coords: number[] = [];
  const ringStarts: number[] = [];
  const ringCounts: number[] = [];
  if (!arcs.getShapeIter) {
    return { positions: new Float32Array(), vertexCount: 0, ringStarts, ringCounts };
  }

  for (const shape of shapes) {
    if (!shape) continue;
    for (const part of shape) {
      if (filter && !part.some((arcId: number) => filter(arcId >= 0 ? arcId : ~arcId))) {
        continue;
      }
      const iter = arcs.getShapeIter(part);
      const start = coords.length / 2;
      while (iter.hasNext()) {
        coords.push(iter.x, iter.y);
      }
      const count = coords.length / 2 - start;
      if (count > 0) {
        ringStarts.push(start);
        ringCounts.push(count);
      }
    }
  }

  return {
    positions: new Float32Array(coords),
    vertexCount: coords.length / 2,
    ringStarts,
    ringCounts,
  };
}
```

- [ ] **Step 4: Run conversion tests**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts
```

Expected: PASS.

---

### Task 5: Implement WebGLPainter Skeleton with luma Models

**Files:**
- Create: `src/renderer/webgl-painter.test.ts`
- Create: `src/renderer/webgl-painter.ts`

- [ ] **Step 1: Write failing smoke tests**

Create `src/renderer/webgl-painter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { AffineTransform } from '../geo/transform';
import { WebGLPainter } from './webgl-painter';

function makeCanvas(gl: any = {}) {
  return {
    width: 0,
    height: 0,
    style: {},
    getContext: vi.fn((kind: string) => kind === 'webgl2' ? gl : null),
  } as unknown as HTMLCanvasElement;
}

describe('WebGLPainter', () => {
  it('throws when WebGL2 is unavailable', () => {
    const canvas = makeCanvas(null);
    expect(() => new WebGLPainter(canvas)).toThrow('WebGL2');
  });

  it('tracks transform, pixel ratio, resize, and clear without touching Canvas 2D', () => {
    const clear = vi.fn();
    const viewport = vi.fn();
    const gl = { clear, viewport, COLOR_BUFFER_BIT: 1, DEPTH_BUFFER_BIT: 2 };
    const canvas = makeCanvas(gl);
    const painter = new WebGLPainter(canvas);

    painter.setPixelRatio(2);
    painter.resize(100, 50);
    painter.setTransform(new AffineTransform(2, -2, 10, 20));
    painter.clear();

    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(viewport).toHaveBeenCalledWith(0, 0, 200, 100);
    expect(clear).toHaveBeenCalledWith(3);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
npm run test:run -- src/renderer/webgl-painter.test.ts
```

Expected: FAIL because `webgl-painter.ts` does not exist.

- [ ] **Step 3: Implement the class and luma setup**

Create `src/renderer/webgl-painter.ts` with these responsibilities:

```ts
import { Device } from '@luma.gl/core';
import { Geometry, Model } from '@luma.gl/engine';
import type { Painter, DrawOverlayState } from './painter';
import { AffineTransform } from '../geo/transform';
import type {
  ArcCollection,
  PointStyle,
  StrokeStyle,
  VertexDotStyle,
} from '../types/mapshaper-types';
import {
  buildArcLineGeometry,
  buildPointGeometry,
  buildPolygonRingGeometry,
} from './webgl/geometry';
import {
  parseColor,
  resolvePointUniforms,
  resolveStrokeUniforms,
} from './webgl/style';

const POSITION_VS = `#version 300 es
in vec2 positions;
uniform mat3 u_matrix;
uniform float u_pointSize;
void main() {
  vec3 p = u_matrix * vec3(positions, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}`;

const COLOR_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}`;

export class WebGLPainter implements Painter {
  private _gl: WebGL2RenderingContext;
  private _device: any;
  private _transform: AffineTransform = new AffineTransform();
  private _pixelRatio = window.devicePixelRatio || 1;
  private _width = 0;
  private _height = 0;

  constructor(private _canvas: HTMLCanvasElement) {
    const gl = _canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      stencil: true,
      premultipliedAlpha: true,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('WebGLPainter requires WebGL2');
    this._gl = gl;
    this._device = typeof (Device as any).attach === 'function'
      ? (Device as any).attach(gl)
      : null;
  }

  setTransform(transform: AffineTransform): void {
    this._transform = transform;
  }

  setPixelRatio(ratio: number): void {
    this._pixelRatio = ratio;
  }

  clear(): void {
    this._gl.clear(this._gl.COLOR_BUFFER_BIT | this._gl.DEPTH_BUFFER_BIT);
  }

  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._canvas.width = Math.floor(width * this._pixelRatio);
    this._canvas.height = Math.floor(height * this._pixelRatio);
    this._canvas.style.width = `${width}px`;
    this._canvas.style.height = `${height}px`;
    this._gl.viewport(0, 0, this._canvas.width, this._canvas.height);
  }

  drawArcs(arcs: ArcCollection, style: StrokeStyle, filter?: (i: number) => boolean): void {
    if (style.width === 0) return;
    const geometry = buildArcLineGeometry(arcs, filter);
    this._drawPositions(geometry.positions, geometry.vertexCount, 'line-list', {
      color: resolveStrokeUniforms(style, this._pixelRatio).color,
      pointSize: 1,
    });
  }

  drawPaths(shapes: any[], style: StrokeStyle, arcs: ArcCollection): void {
    if (style.width === 0) return;
    const used = new Set<number>();
    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) used.add(arcId >= 0 ? arcId : ~arcId);
      }
    }
    this.drawArcs(arcs, style, i => used.has(i));
  }

  drawPoints(shapes: any[], style: PointStyle): void {
    const geometry = buildPointGeometry(shapes);
    const uniforms = resolvePointUniforms(style, this._pixelRatio);
    this._drawPositions(geometry.positions, geometry.vertexCount, 'point-list', {
      color: uniforms.color,
      pointSize: uniforms.radius * 2,
    });
  }

  drawPolygonFill(
    shapes: any[],
    arcs: ArcCollection,
    fillColor: string,
    filter?: (i: number) => boolean,
    opacity?: number,
  ): void {
    const geometry = buildPolygonRingGeometry(shapes, arcs as any, filter);
    this._drawPolygonRings(geometry.positions, geometry.ringStarts, geometry.ringCounts, parseColor(fillColor, opacity));
  }

  drawVertexDots(shapes: any[], arcs: ArcCollection, style: VertexDotStyle = {}): void {
    this.drawPolygonFill(
      style.geometryType === 'polygon' ? shapes : [],
      arcs,
      style.polygonFill || 'rgba(0,0,0,0)',
    );
    const positions: number[] = [];
    for (const shape of shapes) {
      if (!shape) continue;
      for (const part of shape) {
        for (const arcId of part) {
          const iter = arcs.getArcIter(arcId >= 0 ? arcId : ~arcId);
          while (iter.hasNext()) positions.push(iter.x, iter.y);
        }
      }
    }
    this._drawPositions(new Float32Array(positions), positions.length / 2, 'point-list', {
      color: parseColor(style.dotColor || '#333'),
      pointSize: (style.dotRadius || 3) * this._pixelRatio * 2,
    });
    if (style.hoverVertex) {
      this._drawPositions(new Float32Array(style.hoverVertex), 1, 'point-list', {
        color: parseColor(style.hoverColor || '#cc6acc'),
        pointSize: (style.hoverRadius || 6) * this._pixelRatio * 2,
      });
    }
  }

  drawDrawingOverlay(state: DrawOverlayState): void {
    const lineCoords: number[] = [];
    const verts = state.vertices;
    for (let i = 1; i < verts.length; i++) {
      lineCoords.push(verts[i - 1][0], verts[i - 1][1], verts[i][0], verts[i][1]);
    }
    if (verts.length > 0 && state.cursorCoord) {
      const last = verts[verts.length - 1];
      lineCoords.push(last[0], last[1], state.cursorCoord[0], state.cursorCoord[1]);
      if (state.geometryType === 'polygon' && verts.length >= 2) {
        const first = verts[0];
        lineCoords.push(state.cursorCoord[0], state.cursorCoord[1], first[0], first[1]);
      }
    }
    this._drawPositions(new Float32Array(lineCoords), lineCoords.length / 2, 'line-list', {
      color: parseColor(state.drawColor || '#0078ff'),
      pointSize: 1,
    });
    this._drawPositions(new Float32Array(verts.flat()), verts.length, 'point-list', {
      color: parseColor(state.drawColor || '#0078ff'),
      pointSize: 8 * this._pixelRatio,
    });
    if (state.snapCoord) {
      this._drawPositions(new Float32Array(state.snapCoord), 1, 'point-list', {
        color: parseColor('#ff4444'),
        pointSize: 14 * this._pixelRatio,
      });
    }
  }

  private _matrix(): Float32Array {
    const sx = 2 / (this._width || 1);
    const sy = -2 / (this._height || 1);
    const tx = -1;
    const ty = 1;
    return new Float32Array([
      this._transform.mx * sx, 0, 0,
      0, this._transform.my * sy, 0,
      this._transform.bx * sx + tx, this._transform.by * sy + ty, 1,
    ]);
  }

  private _drawPositions(
    positions: Float32Array,
    vertexCount: number,
    topology: 'line-list' | 'point-list' | 'triangle-list',
    uniforms: { color: number[]; pointSize: number },
  ): void {
    if (vertexCount === 0 || !this._device) return;
    const geometry = new Geometry({
      topology,
      attributes: {
        POSITION: { size: 2, value: positions },
      },
    });
    const model = new Model(this._device, {
      vs: POSITION_VS,
      fs: COLOR_FS,
      geometry,
    });
    model.setUniforms?.({
      u_matrix: this._matrix(),
      u_color: uniforms.color,
      u_pointSize: uniforms.pointSize,
    });
    model.draw?.();
    model.destroy?.();
  }

  private _drawPolygonRings(
    positions: Float32Array,
    ringStarts: number[],
    ringCounts: number[],
    color: number[],
  ): void {
    for (let i = 0; i < ringStarts.length; i++) {
      const start = ringStarts[i] * 2;
      const end = start + ringCounts[i] * 2;
      this._drawPositions(positions.slice(start, end), ringCounts[i], 'triangle-list', {
        color,
        pointSize: 1,
      });
    }
  }
}
```

If the installed luma version exposes `luma.attachDevice(...)` instead of
`Device.attach(...)`, change only the constructor's device-attachment line in
`WebGLPainter` and keep the public `WebGLPainter` constructor synchronous. Do
not leak luma types into `Emap`.

- [ ] **Step 4: Run smoke tests**

Run:

```bash
npm run test:run -- src/renderer/webgl-painter.test.ts
```

Expected: PASS.

---

### Task 6: Complete Rendering Parity for Phase 1

**Files:**
- Modify: `src/renderer/webgl-painter.ts`
- Modify: `src/renderer/webgl/geometry.ts`
- Modify: `src/renderer/webgl/geometry.test.ts`
- Modify: `src/renderer/webgl-painter.test.ts`

- [ ] **Step 1: Add line-width geometry tests**

Extend `src/renderer/webgl/geometry.test.ts` with:

```ts
import { buildExpandedLineGeometry } from './geometry';

it('expands a segment into a screen-space quad for stable line width', () => {
  const geometry = buildExpandedLineGeometry(
    new Float32Array([0, 0, 10, 0]),
    4,
  );
  expect(geometry.vertexCount).toBe(6);
  expect(Array.from(geometry.positions)).toEqual([
    0, -2, 10, -2, 10, 2,
    0, -2, 10, 2, 0, 2,
  ]);
});
```

- [ ] **Step 2: Implement `buildExpandedLineGeometry`**

Add to `src/renderer/webgl/geometry.ts`:

```ts
export function buildExpandedLineGeometry(
  lineListPositions: Float32Array,
  width: number,
): WebGLPositionGeometry {
  const out: number[] = [];
  const half = width / 2;
  for (let i = 0; i < lineListPositions.length; i += 4) {
    const x1 = lineListPositions[i];
    const y1 = lineListPositions[i + 1];
    const x2 = lineListPositions[i + 2];
    const y2 = lineListPositions[i + 3];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * half;
    const ny = dx / len * half;
    out.push(
      x1 + nx, y1 + ny, x2 + nx, y2 + ny, x2 - nx, y2 - ny,
      x1 + nx, y1 + ny, x2 - nx, y2 - ny, x1 - nx, y1 - ny,
    );
  }
  return {
    positions: new Float32Array(out),
    vertexCount: out.length / 2,
  };
}
```

- [ ] **Step 3: Use expanded lines in WebGLPainter**

In `drawArcs()` and `drawDrawingOverlay()`, call `buildExpandedLineGeometry(...)`
and draw with `triangle-list` when the requested line width is greater than one
device pixel. Keep `line-list` only for 1-pixel smoke paths.

- [ ] **Step 4: Add polygon limitation tests and doc comment**

Add a test proving `drawPolygonFill` uses `buildPolygonRingGeometry` and does
not call `arcs.getArcIter` directly. This protects reversed arc behavior.

In `WebGLPainter.drawPolygonFill`, add one concise comment:

```ts
// Phase 1 keeps polygon conversion shape-aware; Phase 2 replaces this simple
// ring draw with a stencil evenodd fill path for large arbitrary polygons.
```

- [ ] **Step 5: Run rendering helper tests**

Run:

```bash
npm run test:run -- src/renderer/webgl/geometry.test.ts src/renderer/webgl-painter.test.ts
```

Expected: PASS.

---

### Task 7: Wire Map Integration and Public Exports

**Files:**
- Modify: `src/map/types.ts`
- Modify: `src/map/map.ts`
- Modify: `src/index.ts`
- Modify: `src/renderer/painter-factory.test.ts`

- [ ] **Step 1: Add Emap-level construction test**

Extend `src/renderer/painter-factory.test.ts` with a direct factory test for
`renderer: 'canvas'`, `renderer: 'webgl'`, and `renderer: 'auto'`. Keep `Emap`
constructor tests out of this task to avoid interacting with current unrelated
camera/basemap changes on the branch.

- [ ] **Step 2: Apply imports and factory wiring**

Use the import and constructor replacement from Task 2. After the edit, this
constructor block should read:

```ts
    this._painter = createPainter(this._canvas, {
      renderer: options.renderer,
    }).painter;
    this._painter.setPixelRatio(window.devicePixelRatio || 1);
    this._editOverlay = new EditOverlayRenderer(this._painter);
```

- [ ] **Step 3: Add public exports**

Ensure `src/index.ts` has:

```ts
export { WebGLPainter } from './renderer/webgl-painter';
export { createPainter } from './renderer/painter-factory';
export type {
  PainterFactoryOptions,
  PainterFactoryResult,
} from './renderer/painter-factory';
export type { RendererType } from './map/types';
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
npm run test:run -- src/renderer/painter-factory.test.ts src/renderer/webgl/geometry.test.ts src/renderer/webgl/style.test.ts src/renderer/webgl-painter.test.ts
npm run typecheck
```

Expected: PASS.

---

### Task 8: Document Renderer Option and Phase 1 Limits

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add renderer option example**

In the "Layers and Rendering" section, add:

````md
Canvas 2D remains the default renderer:

```ts
const map = new Emap({ container: 'map' });
```

To opt into the experimental WebGL renderer:

```ts
const map = new Emap({
  container: 'map',
  renderer: 'webgl',
});
```

`renderer: 'auto'` tries WebGL first and falls back to Canvas 2D when WebGL
initialization fails. The WebGL renderer is optional; existing Canvas behavior
is unchanged when `renderer` is omitted.
````

- [ ] **Step 2: Update known limitations**

Replace the Canvas-only limitation with:

```md
- Canvas 2D remains the default renderer. The optional WebGL renderer is
  experimental in Phase 1: it targets painter-interface parity and fallback
  behavior first. Geometry caching, full performance benchmarks, MapLibre
  Custom Layer context sharing, symbol placement, and tiled vector sources are
  separate follow-up phases.
```

- [ ] **Step 3: Run documentation-adjacent checks**

Run:

```bash
npm run typecheck
npm run test:run -- src/renderer/painter-factory.test.ts src/renderer/webgl/geometry.test.ts src/renderer/webgl/style.test.ts src/renderer/webgl-painter.test.ts
```

Expected: PASS.

---

### Task 9: Final Verification and Commit

**Files:**
- All files touched in Tasks 1-8.

- [ ] **Step 1: Run full verification**

Run:

```bash
npm run typecheck
npm run test:run
npm run build
```

Expected: all PASS.

- [ ] **Step 2: Inspect scoped diff**

Run:

```bash
git diff -- package.json package-lock.json pnpm-lock.yaml rollup.config.mjs src/renderer src/map/types.ts src/map/map.ts src/index.ts README.md
git status --short --branch
```

Expected: WebGL implementation files and dependency metadata are present. Existing unrelated branch changes remain visible but are not staged unless they are one of the listed WebGL paths.

- [ ] **Step 3: Run GitNexus change detection**

Run through the GitNexus MCP tool:

```text
detect_changes(scope: "all", repo: "emap")
```

Expected: changed symbols include painter factory, WebGL painter, renderer option, and `Emap` constructor wiring. If risk is HIGH or CRITICAL because of unrelated pre-existing worktree edits, note that in the final report and verify the commit path list manually.

- [ ] **Step 4: Commit only WebGL Phase 1 files**

Run:

```bash
git add package.json package-lock.json pnpm-lock.yaml rollup.config.mjs \
  src/renderer/painter-factory.ts src/renderer/painter-factory.test.ts \
  src/renderer/webgl src/renderer/webgl-painter.ts src/renderer/webgl-painter.test.ts \
  src/map/types.ts src/map/map.ts src/index.ts README.md
git commit -m "Add optional luma WebGL painter" \
  -m "Canvas remains the default renderer while renderer: 'webgl' and 'auto' route through a factory that can fall back to Canvas when WebGL initialization fails. The first WebGL painter keeps Mapshaper ArcCollection as the topology source and derives typed arrays at render time." \
  -m "Constraint: ArcCollection remains the editing source of truth" \
  -m "Constraint: MapLibre Custom Layer context sharing is deferred to the next phase" \
  -m "Rejected: Replace Canvas default | backward compatibility requires no renderer option behavior change" \
  -m "Confidence: medium" \
  -m "Scope-risk: moderate" \
  -m "Tested: npm run typecheck; npm run test:run; npm run build"
```

- [ ] **Step 5: Final report**

Report:

- Changed files.
- Whether Canvas default behavior is unchanged.
- What WebGL features are implemented in Phase 1.
- Remaining risks: luma API drift, polygon evenodd completeness, no benchmark yet, no MapLibre shared context yet.
- Verification commands and results.
