import { describe, expect, it, vi } from 'vitest';
import {
  EMAP_THEME_COLORS,
  EMAP_THEME_FALLBACKS,
  resolveThemeColor,
} from './colors';

describe('emap semantic theme colors', () => {
  it('resolves every semantic role through its stable emap variable', () => {
    const values: Record<string, string> = {
      '--emap-foreground': 'canvas-foreground',
      '--emap-primary': 'canvas-primary',
      '--emap-muted': 'canvas-muted',
      '--emap-selection-bg': 'canvas-selection',
      '--emap-destructive': 'canvas-destructive',
    };
    const expected = [
      'canvas-foreground',
      'canvas-primary',
      'canvas-muted',
      'canvas-selection',
      'canvas-destructive',
    ];
    const read = vi.fn((name: string) => values[name] ?? '');

    const resolved = Object.keys(EMAP_THEME_COLORS).map((role) =>
      resolveThemeColor(
        EMAP_THEME_COLORS[role as keyof typeof EMAP_THEME_COLORS],
        EMAP_THEME_FALLBACKS[role as keyof typeof EMAP_THEME_FALLBACKS],
        read,
      ),
    );

    expect(resolved).toEqual(expected);
  });

  it('uses the approved light fallback for each missing semantic variable', () => {
    expect(
      Object.keys(EMAP_THEME_COLORS).map((role) =>
        resolveThemeColor(
          EMAP_THEME_COLORS[role as keyof typeof EMAP_THEME_COLORS],
          EMAP_THEME_FALLBACKS[role as keyof typeof EMAP_THEME_FALLBACKS],
          () => '',
        ),
      ),
    ).toEqual([
      'oklch(0.2500 0.0100 149)',
      'oklch(0.6270 0.1940 149)',
      'oklch(0.9700 0.0020 149)',
      'oklch(0.9500 0.0300 149)',
      'oklch(0.6000 0.1800 25)',
    ]);
  });

  it('passes literal colors without reading computed variables', () => {
    const read = vi.fn();
    expect(resolveThemeColor('#123456', 'black', read)).toBe('#123456');
    expect(read).not.toHaveBeenCalled();
  });

  it('resolves nested variables and their inline fallback', () => {
    const values: Record<string, string> = {
      '--emap-primary': 'var(--primary, oklch(0.6270 0.1940 149))',
      '--primary': '',
    };
    expect(resolveThemeColor('var(--emap-primary)', 'black', (name) => values[name] ?? '')).toBe(
      'oklch(0.6270 0.1940 149)',
    );
  });

  it('uses the supplied semantic fallback for missing and cyclic variables', () => {
    expect(resolveThemeColor('var(--missing)', 'oklch(1 0 0)', () => '')).toBe(
      'oklch(1 0 0)',
    );
    const cycle: Record<string, string> = { '--a': 'var(--b)', '--b': 'var(--a)' };
    expect(resolveThemeColor('var(--a)', 'oklch(1 0 0)', (name) => cycle[name] ?? '')).toBe(
      'oklch(1 0 0)',
    );
  });
});
