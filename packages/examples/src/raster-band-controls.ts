import type { RasterMetadata, RasterStyle } from '@mapseekai/emap/geotiff';

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing raster control: ${id}`);
  return found as T;
}

/** Example UI only: bands remain the engine's source of truth for rendering mode. */
export function attachRasterBandControls(apply: (style: RasterStyle) => void): {
  setSource(metadata: RasterMetadata | null): void;
  dispose(): void;
} {
  const mode = element<HTMLSelectElement>('render-mode');
  const rgb = ['red-band', 'green-band', 'blue-band'].map((id) => element<HTMLSelectElement>(id));
  const gray = element<HTMLSelectElement>('gray-band');
  const selectors = [...rgb, gray];
  const option = (value: string): HTMLOptionElement => {
    const found = [...mode.options].find((entry) => entry.value === value);
    if (!found) throw new Error(`Missing raster mode: ${value}`);
    return found;
  };
  let available = false;
  const syncMode = () => {
    element('rgb-bands').hidden = mode.value !== 'rgb';
    element('gray-bands').hidden = mode.value !== 'gray';
    for (const select of rgb) select.disabled = !available || mode.value !== 'rgb';
    gray.disabled = !available || mode.value !== 'gray';
  };
  const change = () => {
    syncMode();
    if (!available) return;
    const bands =
      mode.value === 'palette'
        ? undefined
        : mode.value === 'gray'
          ? [Number(gray.value)]
          : rgb.map((select) => Number(select.value));
    apply({ bands, ranges: undefined });
  };
  for (const control of [mode, ...selectors]) control.addEventListener('change', change);
  return {
    setSource(metadata) {
      available = metadata !== null;
      mode.disabled = !available;
      if (!metadata) {
        syncMode();
        return;
      }
      const level = metadata.levels[0];
      const bands = Array.from({ length: level.samples }, (_, i) => i).filter(
        (band) => band !== metadata.alphaBand,
      );
      const prefixes: Record<number, string> = { 1: 'UInt', 2: 'Int', 3: 'Float' };
      for (const [index, select] of selectors.entries()) {
        select.replaceChildren();
        for (const band of bands) {
          const entry = document.createElement('option');
          entry.value = String(band);
          entry.textContent = `波段 ${band + 1} · ${prefixes[level.formats[band]]}${level.bits[band]}`;
          select.append(entry);
        }
        select.value = String(bands[index === 3 ? 0 : Math.min(index, bands.length - 1)]);
      }
      option('rgb').disabled = bands.length < 3;
      option('palette').hidden = !metadata.palette;
      option('palette').disabled = !metadata.palette;
      mode.value = metadata.palette ? 'palette' : bands.length >= 3 ? 'rgb' : 'gray';
      element('band-hint').textContent =
        `${bands.length} 个可用数据波段${metadata.alphaBand === null ? '' : '；Alpha 单独用于透明度'}。界面波段从 1 开始，API 索引从 0 开始。`;
      syncMode();
    },
    dispose() {
      for (const control of [mode, ...selectors]) control.removeEventListener('change', change);
    },
  };
}
