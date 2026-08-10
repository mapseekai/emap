export const EMAP_THEME_COLORS = {
  foreground: 'var(--emap-foreground)',
  primary: 'var(--emap-primary)',
  muted: 'var(--emap-muted)',
  selection: 'var(--emap-selection-bg)',
  destructive: 'var(--emap-destructive)',
} as const;

export const EMAP_THEME_FALLBACKS = {
  foreground: 'oklch(0.2500 0.0100 149)',
  primary: 'oklch(0.6270 0.1940 149)',
  muted: 'oklch(0.9700 0.0020 149)',
  selection: 'oklch(0.9500 0.0300 149)',
  destructive: 'oklch(0.6000 0.1800 25)',
} as const;

export type ThemeColorRole = keyof typeof EMAP_THEME_COLORS;

const CSS_VARIABLE = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/s;
const MAX_VARIABLE_DEPTH = 16;

export function resolveThemeColor(
  value: string,
  fallback: string,
  readVariable: (name: string) => string,
): string {
  let candidate = value.trim();
  const seen = new Set<string>();

  for (let depth = 0; depth < MAX_VARIABLE_DEPTH; depth++) {
    const match = CSS_VARIABLE.exec(candidate);
    if (!match) return candidate || fallback;
    const [, name, inlineFallback] = match;
    if (seen.has(name)) return fallback;
    seen.add(name);
    candidate = readVariable(name).trim() || inlineFallback?.trim() || fallback;
  }

  return fallback;
}
