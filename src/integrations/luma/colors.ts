import {
  EMAP_THEME_COLORS,
  EMAP_THEME_FALLBACKS,
  resolveThemeColor,
  type ThemeColorRole,
} from '../../ui/theme/colors';
import type { Rgba } from './types';
const aliases: Record<ThemeColorRole, readonly string[]> = {
  foreground: ['--foreground', '--emap-foreground'],
  primary: ['--primary', '--emap-primary', '--emap-accent'],
  muted: ['--muted', '--emap-muted'],
  selection: ['--selection-bg', '--emap-selection-bg'],
  destructive: ['--destructive', '--emap-destructive', '--emap-danger'],
};
/** Canvas is used only for browser CSS-color parsing, never to paint map geometry. */
export class GpuColors {
  private context: CanvasRenderingContext2D;
  private computed?: CSSStyleDeclaration;
  private cache = new Map<string, Rgba>();
  constructor(private canvas: HTMLCanvasElement) {
    const sample = canvas.ownerDocument.createElement('canvas');
    sample.width = sample.height = 1;
    const context = sample.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('CSS color parser could not create a 2D context');
    this.context = context;
  }
  reset(): void {
    this.computed = undefined;
  }
  resolve(value: string | undefined, role: ThemeColorRole): Rgba {
    const color = value || EMAP_THEME_COLORS[role];
    const tokenRole =
      (Object.keys(EMAP_THEME_COLORS) as ThemeColorRole[]).find(
        (key) => EMAP_THEME_COLORS[key] === color,
      ) ?? role;
    const resolved = resolveThemeColor(color, EMAP_THEME_FALLBACKS[tokenRole], (name) => {
      this.computed ??= this.canvas.ownerDocument.defaultView?.getComputedStyle(this.canvas);
      const names = color === EMAP_THEME_COLORS[tokenRole] ? aliases[tokenRole] : [name];
      for (const variable of names) {
        const v = this.computed?.getPropertyValue(variable).trim();
        if (v) return v;
      }
      return '';
    });
    const cached = this.cache.get(resolved);
    if (cached) return cached;
    const ctx = this.context;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = EMAP_THEME_FALLBACKS[tokenRole];
    ctx.fillStyle = resolved;
    ctx.fillRect(0, 0, 1, 1);
    const data = ctx.getImageData(0, 0, 1, 1).data;
    const rgba: Rgba = [data[0] / 255, data[1] / 255, data[2] / 255, data[3] / 255];
    if (this.cache.size >= 512) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(resolved, rgba);
    return rgba;
  }
  dispose(): void {
    this.cache.clear();
    this.computed = undefined;
    this.context.canvas.width = this.context.canvas.height = 0;
  }
}
