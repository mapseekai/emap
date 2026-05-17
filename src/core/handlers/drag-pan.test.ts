// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DragPanHandler } from './drag-pan';

function makeEl() { return document.createElement('div'); }

describe('DragPanHandler', () => {
  it('is enabled by default and exposes name "dragPan"', () => {
    const h = new DragPanHandler(makeEl());
    expect(h.name).toBe('dragPan');
    expect(h.isEnabled()).toBe(true);
    h.destroy();
  });

  it('disable() stops pan events; enable() restores them', () => {
    const el = makeEl();
    const h = new DragPanHandler(el);
    const onPan = vi.fn();
    h.on('pan', onPan);

    h.disable();
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 0 }));
    expect(onPan).not.toHaveBeenCalled();

    h.enable();
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0 }));
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 0 }));
    expect(onPan).toHaveBeenCalledWith(expect.objectContaining({ dx: 10, dy: 0 }));
    h.destroy();
  });

  it('re-emits panstart on mousedown and panend on mouseup', () => {
    const el = makeEl();
    const h = new DragPanHandler(el);
    const onStart = vi.fn();
    const onEnd = vi.fn();
    h.on('panstart', onStart);
    h.on('panend', onEnd);
    el.dispatchEvent(new MouseEvent('mousedown', { clientX: 0, clientY: 0 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 0, clientY: 0 }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    h.destroy();
  });

  it('handlePointer is a no-op passthrough in Phase 1 (DOM-driven)', () => {
    const h = new DragPanHandler(makeEl());
    expect(h.handlePointer({
      kind: 'down', point: { x: 0, y: 0 },
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      button: 0, originalEvent: new MouseEvent('mousedown'),
    })).toBe('passthrough');
    h.destroy();
  });
});
