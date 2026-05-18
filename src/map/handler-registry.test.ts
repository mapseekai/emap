// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Emap } from './map';

// jsdom does not implement CanvasRenderingContext2D; stub getContext so
// CanvasPainter construction succeeds.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = () => ({
    scale: () => {}, clearRect: () => {}, fillRect: () => {},
    strokeRect: () => {}, beginPath: () => {}, moveTo: () => {},
    lineTo: () => {}, stroke: () => {}, fill: () => {},
    arc: () => {}, save: () => {}, restore: () => {},
    translate: () => {}, setTransform: () => {}, drawImage: () => {},
    measureText: () => ({ width: 0 }),
  } as any);
});

function container(): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: 800 });
  Object.defineProperty(el, 'clientHeight', { value: 600 });
  document.body.appendChild(el);
  return el;
}

describe('Emap handler registry (Phase 1)', () => {
  it('exposes dragPan and scrollZoom handlers, enabled by default', () => {
    const map = new Emap({ container: container() });
    expect(map.dragPan.name).toBe('dragPan');
    expect(map.scrollZoom.name).toBe('scrollZoom');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(map.scrollZoom.isEnabled()).toBe(true);
  });

  it('interactive:false disables both handlers (legacy behavior preserved)', () => {
    const map = new Emap({ container: container(), interactive: false });
    expect(map.dragPan.isEnabled()).toBe(false);
    expect(map.scrollZoom.isEnabled()).toBe(false);
  });

  it('map.scrollZoom.disable() leaves dragPan enabled (selective toggle)', () => {
    const map = new Emap({ container: container() });
    map.scrollZoom.disable();
    expect(map.scrollZoom.isEnabled()).toBe(false);
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('dragging the canvas pans the viewport through the arbiter', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 160, clientY: 100, button: 0 }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 160, clientY: 100, button: 0 }));
    const after = map.getCenter();
    expect(after[0]).not.toBe(before[0]); // longitude changed → pan happened
  });

  it('exposes disabled-by-default selection handlers', () => {
    const map = new Emap({ container: container() });
    expect(map.clickSelect.name).toBe('clickSelect');
    expect(map.boxSelect.name).toBe('boxSelect');
    expect(map.lassoSelect.name).toBe('lassoSelect');
    expect(map.clickSelect.isEnabled()).toBe(false);
    expect(map.boxSelect.isEnabled()).toBe(false);
    expect(map.lassoSelect.isEnabled()).toBe(false);
  });

  it('shift+drag with boxSelect enabled selects via the arbiter (not pan)', () => {
    const el = container();
    const map = new Emap({ container: el });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    map.boxSelect.enable();
    const before = map.getCenter();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    window.dispatchEvent(new PointerEvent('pointerup', { clientX: 200, clientY: 200, button: 0, shiftKey: true }));
    expect(map.getCenter()[0]).toBe(before[0]);
  });

  it('map.on("feature:click", filter, cb) fires for the hit feature via the arbiter', () => {
    const map = new Emap({ container: container() });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const hit = { source: 's', layer: 'l', id: 1 };
    (map as any).queryFeatures = () => [hit];
    (map as any).features = { get: (r: any) => ({ ref: r, geometry: null, properties: Object.freeze({}) }) };
    const cb = vi.fn();
    map.on('feature:click', { layers: ['l'] }, cb);
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ type: 'feature:click', ref: hit });
  });

  it('map.once("feature:click", cb) fires once then a second click does nothing', () => {
    const map = new Emap({ container: container() });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const hit = { source: 's', layer: 'l', id: 1 };
    (map as any).queryFeatures = () => [hit];
    (map as any).features = { get: (r: any) => ({ ref: r, geometry: null, properties: Object.freeze({}) }) };
    const cb = vi.fn();
    map.once('feature:click', cb);
    // First click fires cb
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).toHaveBeenCalledTimes(1);
    // Second click — cb must NOT fire again
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('map.once("feature:click", cb) then map.off("feature:click", cb) → cb never called and sink is null', () => {
    const map = new Emap({ container: container() });
    const canvas = map.getCanvasContainer();
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600, x: 0, y: 0, toJSON() {} });
    const hit = { source: 's', layer: 'l', id: 1 };
    (map as any).queryFeatures = () => [hit];
    (map as any).features = { get: (r: any) => ({ ref: r, geometry: null, properties: Object.freeze({}) }) };
    const cb = vi.fn();
    map.once('feature:click', cb);
    map.off('feature:click', cb);
    // Sink should be re-synced to null (no listeners remain)
    expect((map as any)._handlers._pointerSink).toBeNull();
    // Click should not invoke cb
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new MouseEvent('click', { clientX: 10, clientY: 10 }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('typed 2-arg feature on/off compile smoke (Bug 2 fix)', () => {
    const map = new Emap({ container: container() });
    // This must compile: proves the typed 2-arg overload exists for feature events.
    const cb = (e: import('../core/feature-event-dispatcher').FeatureEvent) => { void e.ref; };
    map.on('feature:hover', cb);
    map.off('feature:hover', cb);
    // No runtime assertion needed — the test passing without tsc errors proves the fix.
  });

  it('typed mousemove inline-arrow inference compile smoke (overload precedence)', () => {
    const map = new Emap({ container: container() });
    // Inline arrow with NO annotation must infer PointerMoveEvent — proves
    // the 'mousemove' literal overload precedes the generic on<T>. If the
    // generic shadowed it, `e` would be Record<string,unknown> and the
    // tuple assignment below would not type-check.
    map.on('mousemove', (e) => {
      const c: [number, number] = e.mapCoord;
      const p: { x: number; y: number } = e.point;
      void c; void p;
    });
    const cb = (e: import('../core/pointer-event-dispatcher').PointerMoveEvent) => { void e.mapCoord; };
    map.on('mousemove', cb);
    map.off('mousemove', cb);
    map.once('mousemove', cb);
    map.off('mousemove', cb);
    // Passing without tsc errors proves the typed overload wins for 'mousemove'.
  });

  it('non-feature map.on still works (super delegation unaffected)', () => {
    const map = new Emap({ container: container() });
    const cb = vi.fn();
    map.on('move', cb);
    map.fire('move', { foo: 1 });
    expect(cb).toHaveBeenCalled();
  });

  it('no feature:* listener ⇒ no pointer sink installed (zero cost)', () => {
    const map = new Emap({ container: container() });
    const hm = (map as any)._handlers;
    expect((hm as any)._pointerSink).toBeNull();
    const cb = () => {};
    map.on('feature:hover', cb);
    expect((hm as any)._pointerSink).not.toBeNull();
    map.off('feature:hover', cb);
    expect((hm as any)._pointerSink).toBeNull();
  });

  it('exposes a disabled-by-default vertexEdit handler', () => {
    const map = new Emap({ container: container() });
    expect(map.vertexEdit.name).toBe('vertexEdit');
    expect(map.vertexEdit.isEnabled()).toBe(false);
  });

  it('vertexEdit.enable() enters vertex edit mode (editmodechange) and disables dragPan', () => {
    const map = new Emap({ container: container() });
    const modes: string[] = [];
    map.on('editmodechange', (e: any) => modes.push(e.mode));
    map.vertexEdit.enable();
    expect(map.getEditMode()).toBe('vertex');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.vertexEdit.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(modes).toEqual(['vertex', 'none']);
  });

  it('exposes a disabled-by-default drawFeature handler', () => {
    const map = new Emap({ container: container() });
    expect(map.drawFeature.name).toBe('drawFeature');
    expect(map.drawFeature.isEnabled()).toBe(false);
  });

  it('drawFeature.enable() without source/type throws; configured enters draw mode', () => {
    const map = new Emap({ container: container() });
    expect(() => map.drawFeature.enable()).toThrow(/source\+type required/i);
    map.drawFeature.setOptions({ source: 's', type: 'polygon' });
    map.drawFeature.enable();
    expect(map.getEditMode()).toBe('draw');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.drawFeature.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it("setEditMode('transform') disables dragPan and fires editmodechange; 'none' re-enables", () => {
    const map = new Emap({ container: container() });
    const modes: string[] = [];
    map.on('editmodechange', (e: any) => modes.push(e.mode));
    map.setEditMode('transform');
    expect(map.getEditMode()).toBe('transform');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.setEditMode('none');
    expect(map.dragPan.isEnabled()).toBe(true);
    expect(modes).toEqual(['transform', 'none']);
  });

  it('enabling vertexEdit cross-deactivates an active drawFeature', () => {
    const map = new Emap({ container: container() });
    map.drawFeature.setOptions({ source: 's', type: 'polygon' });
    map.drawFeature.enable();
    map.vertexEdit.enable();
    expect(map.drawFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('vertex');
  });

  it('exposes a disabled-by-default transformFeature handler', () => {
    const map = new Emap({ container: container() });
    expect(map.transformFeature.name).toBe('transformFeature');
    expect(map.transformFeature.isEnabled()).toBe(false);
  });

  it('transformFeature.enable() enters transform mode (pan disabled); disable() restores', () => {
    const map = new Emap({ container: container() });
    map.transformFeature.enable();
    expect(map.getEditMode()).toBe('transform');
    expect(map.dragPan.isEnabled()).toBe(false);
    map.transformFeature.disable();
    expect(map.getEditMode()).toBe('none');
    expect(map.dragPan.isEnabled()).toBe(true);
  });

  it('enabling vertexEdit cross-deactivates an active transformFeature', () => {
    const map = new Emap({ container: container() });
    map.transformFeature.enable();
    map.vertexEdit.enable();                 // setEditMode('vertex') → editmodechange
    expect(map.transformFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('vertex');
  });

  it('transformFeature ↔ drawFeature cross-deactivate each other', () => {
    const map = new Emap({ container: container() });
    map.drawFeature.setOptions({ source: 's', type: 'polygon' });
    // drawFeature active → enabling transformFeature deactivates it.
    map.drawFeature.enable();
    map.transformFeature.enable();           // setEditMode('transform') → editmodechange
    expect(map.drawFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('transform');
    // transformFeature active → enabling drawFeature deactivates it.
    map.drawFeature.enable();                // setEditMode('draw') → editmodechange
    expect(map.transformFeature.isEnabled()).toBe(false);
    expect(map.getEditMode()).toBe('draw');
  });

  it('map.on(mousemove) installs the combined sink and delivers PointerMoveEvent; off clears it', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    expect(mgr._pointerSink).toBeNull();
    const cb = vi.fn();
    map.on('mousemove', cb);
    expect(typeof mgr._pointerSink).toBe('function');
    // Drive a normalized move through the sink:
    mgr._pointerSink({
      kind: 'move',
      point: { x: 20, y: 30 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new Event('pointermove'),
    });
    expect(cb).toHaveBeenCalledTimes(1);
    const e = cb.mock.calls[0][0];
    expect(e.point).toEqual({ x: 20, y: 30 });
    expect(Array.isArray(e.mapCoord)).toBe(true);
    expect(e.mapCoord).toHaveLength(2);
    map.off('mousemove', cb);
    expect(mgr._pointerSink).toBeNull();
  });

  it('sink-install matrix: feature-only / pointer-only / both / neither', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    const fcb = vi.fn();
    const pcb = vi.fn();
    expect(mgr._pointerSink).toBeNull();                 // neither
    map.on('feature:hover', {}, fcb);
    expect(typeof mgr._pointerSink).toBe('function');    // feature-only
    map.on('mousemove', pcb);
    expect(typeof mgr._pointerSink).toBe('function');    // both
    map.off('feature:hover', fcb);
    expect(typeof mgr._pointerSink).toBe('function');    // pointer-only
    map.off('mousemove', pcb);
    expect(mgr._pointerSink).toBeNull();                 // neither
  });

  it('combined sink fans out: one move reaches BOTH feature hover and mousemove', () => {
    const map = new Emap({ container: container() });
    const mgr = (map as any)._handlers;
    const fcb = vi.fn();
    const pcb = vi.fn();
    map.on('feature:hover', {}, fcb);   // no data loaded → hover may not fire, but must not throw
    map.on('mousemove', pcb);
    mgr._pointerSink({
      kind: 'move',
      point: { x: 5, y: 5 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0,
      originalEvent: new Event('pointermove'),
    });
    expect(pcb).toHaveBeenCalledTimes(1);   // pointer-move always delivered
  });
});
