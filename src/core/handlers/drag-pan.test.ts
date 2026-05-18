// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { DragPanHandler } from './drag-pan';
import type { NormalizedPointerEvent } from '../handler';

function ev(kind: NormalizedPointerEvent['kind'], x: number, y: number, shift = false): NormalizedPointerEvent {
  return {
    kind, point: { x, y },
    modifiers: { shift, ctrl: false, alt: false, meta: false },
    button: 0, originalEvent: new MouseEvent(kind === 'down' ? 'pointerdown' : 'pointermove'),
  };
}

describe('DragPanHandler (arbitrated)', () => {
  it('name + enabled-by-default + handlePointer passthrough when disabled', () => {
    const h = new DragPanHandler();
    expect(h.name).toBe('dragPan');
    expect(h.isEnabled()).toBe(true);
    h.disable();
    expect(h.handlePointer(ev('down', 0, 0))).toBe('passthrough');
  });

  it('down (no shift) → exclusive + panstart; move → pan {dx,dy}; up → panend + releases', () => {
    const h = new DragPanHandler();
    const start = vi.fn(); const pan = vi.fn(); const end = vi.fn();
    h.on('panstart', start); h.on('pan', pan); h.on('panend', end);

    expect(h.handlePointer(ev('down', 10, 10))).toBe('exclusive');
    expect(start).toHaveBeenCalledTimes(1);

    expect(h.handlePointer(ev('move', 25, 18))).toBe('exclusive');
    expect(pan).toHaveBeenCalledWith(expect.objectContaining({ dx: 15, dy: 8 }));

    expect(h.handlePointer(ev('up', 25, 18))).toBe('passthrough');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('skipShiftDrag (default true): shift+down is passthrough, no gesture', () => {
    const h = new DragPanHandler();
    const start = vi.fn(); h.on('panstart', start);
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('passthrough');
    expect(start).not.toHaveBeenCalled();
  });

  it('setOptions({skipShiftDrag:false}) lets shift+drag pan', () => {
    const h = new DragPanHandler();
    h.setOptions({ skipShiftDrag: false });
    expect(h.handlePointer(ev('down', 0, 0, true))).toBe('exclusive');
  });
});

describe('DragPanHandler.getCursor (DX P11)', () => {
  it('returns grab when enabled & idle, grabbing while dragging, null when disabled', () => {
    const h = new DragPanHandler();
    expect(h.getCursor()).toBe('grab');
    h.handlePointer(ev('down', 0, 0));
    expect(h.getCursor()).toBe('grabbing');
    h.disable();
    expect(h.getCursor()).toBeNull();
  });
});
