import { describe, it, expect } from 'vitest';
import { resolveMode } from './select-mode';
import type { ModifierCombo, SelectMode } from './select-mode';

function mods(s = false, c = false, a = false, m = false) {
  return { shift: s, ctrl: c, alt: a, meta: m };
}
const BOX_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'ctrl', toggle: 'alt' };
const CLICK_TABLE: Partial<Record<SelectMode, ModifierCombo>> =
  { replace: 'none', add: 'shift', toggle: 'shift+alt' };

describe('resolveMode', () => {
  it('clickSelect (no activator): plain → replace, shift → add, shift+alt → toggle', () => {
    expect(resolveMode(mods(), CLICK_TABLE)).toBe('replace');
    expect(resolveMode(mods(true), CLICK_TABLE)).toBe('add');
    expect(resolveMode(mods(true, false, true), CLICK_TABLE)).toBe('toggle');
  });

  it('box/lasso (activator=shift): reproduces today exactly', () => {
    expect(resolveMode(mods(true), BOX_TABLE, 'shift')).toBe('replace');
    expect(resolveMode(mods(true, true), BOX_TABLE, 'shift')).toBe('add');
    expect(resolveMode(mods(true, false, true), BOX_TABLE, 'shift')).toBe('toggle');
    expect(resolveMode(mods(true, false, false, true), BOX_TABLE, 'shift')).toBe('replace');
  });

  it('unmatched combo falls back to replace', () => {
    expect(resolveMode(mods(false, false, false, true), CLICK_TABLE)).toBe('replace');
  });

  it('canonical combo order is shift+ctrl+alt+meta regardless of held order', () => {
    const table: Partial<Record<SelectMode, ModifierCombo>> = { add: 'shift+ctrl' };
    expect(resolveMode(mods(true, true), table)).toBe('add');
  });
});
