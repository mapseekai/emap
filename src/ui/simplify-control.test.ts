// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { SimplifyControl } from './simplify-control';

interface FakeMap {
  ops: { simplifyLayer: ReturnType<typeof vi.fn> };
}

function makeFakeMap(simplifyImpl?: (opts: any) => Promise<unknown>): FakeMap {
  const impl = simplifyImpl ?? (async () => ({ ok: true }));
  return {
    ops: {
      simplifyLayer: vi.fn(impl as (...args: any[]) => any),
    },
  };
}

describe('SimplifyControl', () => {
  let map: FakeMap;
  let ctrl: SimplifyControl;
  let el: HTMLElement;

  beforeEach(() => {
    map = makeFakeMap();
    ctrl = new SimplifyControl({ source: 's1' });
    el = ctrl.onAdd(map as any);
  });

  it('renders a single toolbar button', () => {
    const btns = el.querySelectorAll('button');
    expect(btns).toHaveLength(2); // toggle button + Apply (inside popup)
    expect((btns[0] as HTMLButtonElement).title).toBe('Simplify geometry');
  });

  it('keeps the popup hidden by default', () => {
    const popup = el.querySelector('.emap-simplify-popup') as HTMLElement;
    expect(popup).not.toBeNull();
    expect(popup.style.display).toBe('none');
  });

  it('opens the popup when the toolbar button is clicked', () => {
    const toggle = el.querySelector('button') as HTMLButtonElement;
    toggle.click();
    const popup = el.querySelector('.emap-simplify-popup') as HTMLElement;
    expect(popup.style.display).toBe('block');
    expect(toggle.classList.contains('active')).toBe(true);
  });

  it('Esc key closes the open popup', () => {
    const toggle = el.querySelector('button') as HTMLButtonElement;
    toggle.click(); // open
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const popup = el.querySelector('.emap-simplify-popup') as HTMLElement;
    expect(popup.style.display).toBe('none');
  });

  it('updates the percentage label as the slider moves', () => {
    (el.querySelector('button') as HTMLButtonElement).click();
    const slider = el.querySelector('input[type=range]') as HTMLInputElement;
    const label = el.querySelector('.value') as HTMLElement;
    slider.value = '42.5';
    slider.dispatchEvent(new Event('input'));
    expect(label.textContent).toBe('42.5%');
  });

  it('passes source, percentage, and method on Apply', async () => {
    (el.querySelector('button') as HTMLButtonElement).click();
    const slider = el.querySelector('input[type=range]') as HTMLInputElement;
    slider.value = '20';
    slider.dispatchEvent(new Event('input'));
    const methodSel = el.querySelector('select') as HTMLSelectElement;
    methodSel.value = 'dp';
    const apply = el.querySelector('button.apply') as HTMLButtonElement;
    apply.click();

    // Wait microtask so the async _apply completes
    await Promise.resolve();
    await Promise.resolve();

    expect(map.ops.simplifyLayer).toHaveBeenCalledTimes(1);
    const call = (map.ops.simplifyLayer as any).mock.calls[0][0];
    expect(call).toMatchObject({
      source: 's1',
      percentage: 20,
      method: 'dp',
      keepShapes: true, // checked by default
    });
    expect(call.target).toBeUndefined();
    expect(call.planar).toBeUndefined();
  });

  it('forwards target when configured', async () => {
    ctrl.onRemove();
    ctrl = new SimplifyControl({ source: 's1', target: 'parks' });
    el = ctrl.onAdd(map as any);
    (el.querySelector('button') as HTMLButtonElement).click();
    (el.querySelector('button.apply') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect((map.ops.simplifyLayer as any).mock.calls[0][0].target).toBe('parks');
  });

  it('forwards planar flag when checked', async () => {
    (el.querySelector('button') as HTMLButtonElement).click();
    const planar = el.querySelector('input[data-flag=planar]') as HTMLInputElement;
    planar.checked = true;
    (el.querySelector('button.apply') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect((map.ops.simplifyLayer as any).mock.calls[0][0].planar).toBe(true);
  });

  it('shows failure status when simplifyLayer returns error', async () => {
    map = makeFakeMap(async () => ({ ok: false, error: { kind: 'validation', field: 'percentage' } }));
    ctrl.onRemove();
    ctrl = new SimplifyControl({ source: 's1' });
    el = ctrl.onAdd(map as any);
    (el.querySelector('button') as HTMLButtonElement).click();
    (el.querySelector('button.apply') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const status = el.querySelector('.status') as HTMLElement;
    expect(status.textContent).toMatch(/Failed.*validation.*percentage/);
  });

  it('honours initialPercentage and initialMethod', () => {
    ctrl.onRemove();
    ctrl = new SimplifyControl({ source: 's1', initialPercentage: 5, initialMethod: 'visvalingam' });
    el = ctrl.onAdd(map as any);
    const slider = el.querySelector('input[type=range]') as HTMLInputElement;
    const label = el.querySelector('.value') as HTMLElement;
    const methodSel = el.querySelector('select') as HTMLSelectElement;
    expect(slider.value).toBe('5');
    expect(label.textContent).toBe('5%');
    expect(methodSel.value).toBe('visvalingam');
  });

  it('cleans up DOM and listeners on remove', () => {
    document.body.appendChild(el);
    expect(document.body.contains(el)).toBe(true);
    ctrl.onRemove();
    expect(document.body.contains(el)).toBe(false);
  });
});
