import zoomInSvg from './assets/controls/zoom-in.svg?raw';
import zoomOutSvg from './assets/controls/zoom-out.svg?raw';
import homeSvg from './assets/controls/home.svg?raw';
import simplifySvg from './assets/controls/simplify.svg?raw';
import polylineSvg from './assets/controls/polyline.svg?raw';
import polygonSvg from './assets/controls/polygon.svg?raw';
import pointSvg from './assets/controls/point.svg?raw';
import editSvg from './assets/controls/edit.svg?raw';
import basemapSvg from './assets/controls/basemap.svg?raw';
import layersSvg from './assets/controls/layers.svg?raw';
import undoSvg from './assets/controls/help-larrow.svg?raw';
import redoSvg from './assets/controls/help-rarrow.svg?raw';
import measureLengthSvg from './assets/controls/measure-length.svg?raw';
import measureAreaSvg from './assets/controls/measure-area.svg?raw';

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

const CONTROL_ICON_SVGS: Readonly<Record<ControlIconName, string>> = {
  'zoom-in': zoomInSvg,
  'zoom-out': zoomOutSvg,
  home: homeSvg,
  simplify: simplifySvg,
  polyline: polylineSvg,
  polygon: polygonSvg,
  point: pointSvg,
  edit: editSvg,
  basemap: basemapSvg,
  layers: layersSvg,
  undo: undoSvg,
  redo: redoSvg,
  'measure-length': measureLengthSvg,
  'measure-area': measureAreaSvg,
};

export function createControlIcon(name: ControlIconName): SVGSVGElement {
  const template = document.createElement('template');
  template.innerHTML = CONTROL_ICON_SVGS[name].trim();
  const icon = template.content.firstElementChild;
  if (!(icon instanceof SVGSVGElement)) {
    throw new Error(`Invalid SVG control icon: ${name}`);
  }

  icon.setAttribute('xmlns', SVG_NAMESPACE);
  if (!icon.hasAttribute('viewBox')) {
    icon.setAttribute('viewBox', '0 0 100 100');
  }
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  for (const path of icon.querySelectorAll<SVGPathElement>('path')) {
    path.style.removeProperty('color');
    path.style.removeProperty('fill');
    path.style.removeProperty('fill-opacity');
    path.setAttribute('fill', 'currentColor');
  }
  return icon;
}
