// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { DragPanHandler } from './drag-pan-handler';

function dispatchMouseDown(el: HTMLElement, opts: { shiftKey?: boolean } = {}): void {
  const e = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    shiftKey: !!opts.shiftKey,
  });
  el.dispatchEvent(e);
}

describe('DragPanHandler', () => {
  let element: HTMLElement;
  let handler: DragPanHandler;

  beforeEach(() => {
    element = document.createElement('div');
    document.body.appendChild(element);
    handler = new DragPanHandler(element);
  });

  afterEach(() => {
    handler.destroy();
    element.remove();
  });

  it('plain mousedown fires panstart and starts dragging', () => {
    const listener = vi.fn();
    handler.on('panstart', listener);
    dispatchMouseDown(element);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(handler.isDragging()).toBe(true);
  });

  it('shift+mousedown does NOT fire panstart and does not start dragging', () => {
    const listener = vi.fn();
    handler.on('panstart', listener);
    dispatchMouseDown(element, { shiftKey: true });
    expect(listener).not.toHaveBeenCalled();
    expect(handler.isDragging()).toBe(false);
  });

  it('disabled handler ignores plain mousedown too', () => {
    handler.setEnabled(false);
    const listener = vi.fn();
    handler.on('panstart', listener);
    dispatchMouseDown(element);
    expect(listener).not.toHaveBeenCalled();
    expect(handler.isDragging()).toBe(false);
  });
});

describe('PanGestureSource skipShiftDrag option', () => {
  it('skips shift+drag by default (unchanged behavior)', () => {
    const el = document.createElement('div');
    const src = new DragPanHandler(el);
    const onStart = vi.fn();
    src.on('panstart', onStart);
    el.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, clientX: 0, clientY: 0 }));
    expect(onStart).not.toHaveBeenCalled();
    src.destroy();
  });

  it('pans on shift+drag when skipShiftDrag=false', () => {
    const el = document.createElement('div');
    const src = new DragPanHandler(el, { skipShiftDrag: false });
    const onStart = vi.fn();
    src.on('panstart', onStart);
    el.dispatchEvent(new MouseEvent('mousedown', { shiftKey: true, clientX: 0, clientY: 0 }));
    expect(onStart).toHaveBeenCalledTimes(1);
    src.destroy();
  });
});
