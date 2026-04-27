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
