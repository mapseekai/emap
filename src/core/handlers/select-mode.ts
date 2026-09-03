import type { PointerModifiers } from '../handler';

/** How a selection gesture combines with the existing selection. */
export type SelectMode = 'replace' | 'add' | 'toggle';

/** A canonical chord of modifier keys, '+'-joined in shift+ctrl+alt+meta order. */
export type ModifierCombo =
  | 'none'
  | 'shift'
  | 'ctrl'
  | 'alt'
  | 'meta'
  | 'shift+ctrl'
  | 'shift+alt'
  | 'shift+meta'
  | 'ctrl+alt'
  | 'ctrl+meta'
  | 'alt+meta'
  | 'shift+ctrl+alt'
  | 'shift+ctrl+meta'
  | 'shift+alt+meta'
  | 'ctrl+alt+meta'
  | 'shift+ctrl+alt+meta';

const ORDER = ['shift', 'ctrl', 'alt', 'meta'] as const;
type Key = (typeof ORDER)[number];

/** Held PointerModifiers → canonical combo string ('none' if empty). */
function comboOf(m: Pick<PointerModifiers, Key>): string {
  const held = ORDER.filter((k) => m[k]);
  return held.length === 0 ? 'none' : held.join('+');
}

/** Parse a ModifierCombo to its key set ('none' → empty). */
function keysOf(combo: ModifierCombo): Set<Key> {
  if (combo === 'none') return new Set();
  return new Set(combo.split('+') as Key[]);
}

/**
 * Resolve a {@link SelectMode} from held modifiers.
 *
 * When `activator` is given (box/lasso drag gate), its keys are stripped
 * from the held set first — the gesture-end chord is matched on whatever
 * was held *beyond* the activator. With no `activator` (clickSelect) the
 * full held chord is matched. Unmatched → `'replace'`.
 */
export function resolveMode(
  modifiers: PointerModifiers,
  table: Partial<Record<SelectMode, ModifierCombo>>,
  activator?: ModifierCombo,
): SelectMode {
  const strip = activator ? keysOf(activator) : new Set<Key>();
  const rawCtrl = modifiers.ctrl && !strip.has('ctrl');
  const rawMeta = modifiers.meta && !strip.has('meta');
  const effective = {
    shift: modifiers.shift && !strip.has('shift'),
    // meta≡ctrl (Cmd on macOS ≡ Ctrl): mirrors legacy _modeFromEvent's `ctrlKey || metaKey`.
    ctrl: rawCtrl || rawMeta,
    alt: modifiers.alt && !strip.has('alt'),
    meta: false,
  };
  const combo = comboOf(effective);
  for (const mode of ['replace', 'add', 'toggle'] as const) {
    const want = table[mode];
    if (want && want === combo) return mode;
  }
  return 'replace';
}

/** True iff every key of `combo` is held (extra held keys allowed). */
export function comboHeld(m: PointerModifiers, combo: ModifierCombo): boolean {
  if (combo === 'none') return true;
  return combo.split('+').every((k) => (m as unknown as Record<string, unknown>)[k] === true);
}
