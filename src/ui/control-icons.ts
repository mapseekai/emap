import { CONTROL_ICON_PATHS } from './control-icon-paths';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export type ControlIconName =
  | 'zoom-in'
  | 'zoom-out'
  | 'home'
  | 'simplify'
  | 'polyline'
  | 'polygon'
  | 'point'
  | 'edit'
  | 'basemap'
  | 'layers'
  | 'undo'
  | 'redo'
  | 'measure-length'
  | 'measure-area';

export function createControlIcon(name: ControlIconName): SVGSVGElement {
  const { viewBox = '0 0 100 100', paths } = CONTROL_ICON_PATHS[name];
  const icon = document.createElementNS(SVG_NAMESPACE, 'svg');
  icon.setAttribute('xmlns', SVG_NAMESPACE);
  icon.setAttribute('viewBox', viewBox);
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  for (const { d, fillRule } of paths) {
    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    if (fillRule) path.setAttribute('fill-rule', fillRule);
    icon.appendChild(path);
  }

  return icon;
}
