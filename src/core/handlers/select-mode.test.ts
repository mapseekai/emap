import { describe, it, expect } from 'vitest';
import { resolveMode } from './select-mode';
import type { ModifierCombo, SelectMode } from './select-mode';

function mods(s = false, c = false, a = false, m = false) {
  return { shift: s, ctrl: c, alt: a, meta: m };
}
const BOX_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'shift', toggle: 'shift+alt' };
const ACTIVATED_DRAG_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'ctrl', toggle: 'alt' };
const CLICK_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'shift', toggle: 'shift+alt' };

describe('resolveMode', () => {
  it('clickSelect (no activator): plain → replace, shift → add, shift+alt → toggle', () => {
    expect(resolveMode(mods(), CLICK_TABLE)).toBe('replace');
    expect(resolveMode(mods(true), CLICK_TABLE)).toBe('add');
    expect(resolveMode(mods(true, false, true), CLICK_TABLE)).toBe('toggle');
  });

  it('boxSelect active-tool defaults: plain → replace, shift → add, shift+alt → toggle', () => {
    expect(resolveMode(mods(), BOX_TABLE, 'none')).toBe('replace');
    expect(resolveMode(mods(true), BOX_TABLE, 'none')).toBe('add');
    expect(resolveMode(mods(true, false, true), BOX_TABLE, 'none')).toBe('toggle');
  });

  it('activated drag table (activator=shift): strips activator before resolving mode', () => {
    expect(resolveMode(mods(true), ACTIVATED_DRAG_TABLE, 'shift')).toBe('replace');
    expect(resolveMode(mods(true, true), ACTIVATED_DRAG_TABLE, 'shift')).toBe('add');
    expect(resolveMode(mods(true, false, true), ACTIVATED_DRAG_TABLE, 'shift')).toBe('toggle');
    expect(resolveMode(mods(true, false, false, true), ACTIVATED_DRAG_TABLE, 'shift')).toBe('add'); // shift+meta ≡ shift+ctrl (legacy ctrlKey||metaKey)
  });

  it('unmatched combo falls back to replace', () => {
    expect(resolveMode(mods(false, false, false, true), CLICK_TABLE)).toBe('replace');
  });

  it('canonical combo order is shift+ctrl+alt+meta regardless of held order', () => {
    const table: Partial<Record<SelectMode, ModifierCombo>> = { add: 'shift+ctrl' };
    expect(resolveMode(mods(true, true), table)).toBe('add');
  });
});
