import { cloneLayerSpecification, type LayerSpecification } from './layer';
import { compileSymbolStyle, type SymbolStyle, updateSymbolProperty } from './symbol';
import { symbolStyleFromLegacy } from './symbol-compat';

/** Materialize native settings once at the configuration boundary. Render hot paths remain unchanged. */
export function materializeSymbolLayer(input: LayerSpecification): LayerSpecification {
  const declarative = { ...input };
  if (input.symbol !== undefined) {
    delete declarative.label;
    if (declarative.type === 'circle') delete declarative.icon;
  }
  const layer = cloneLayerSpecification(declarative);
  if (layer.symbol === undefined) return layer;
  const native = compileSymbolStyle(layer.symbol, layer.type);
  layer.label = native.label;
  if (layer.type === 'circle') layer.icon = native.icon;
  return layer;
}
/** Replacement of the attached symbol only. null restores native geometry without text/icons. */
export function replaceLayerSymbol(
  input: LayerSpecification,
  style: SymbolStyle | null,
): LayerSpecification {
  const layer = { ...input };
  delete layer.label;
  if (layer.type === 'circle') delete layer.icon;
  if (style === null) delete layer.symbol;
  else layer.symbol = style;
  return materializeSymbolLayer(layer);
}
export function changeSymbolProperty(
  input: LayerSpecification,
  section: 'layout' | 'paint',
  name: string,
  value: unknown,
): LayerSpecification {
  const style =
    input.symbol ??
    symbolStyleFromLegacy(input.label, input.type === 'circle' ? input.icon : undefined);
  return replaceLayerSymbol(input, updateSymbolProperty(style, section, name, value));
}
