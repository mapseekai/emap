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

export interface ControlButtonOptions {
  /** Full class list, conventionally `emap-ctrl-<id>`. */
  className: string;
  /** Tooltip; also mirrored to aria-label by callers that need it. */
  title: string;
  /** Icon node (see {@link createControlIcon}) or a plain string label. */
  icon: string | Node;
  onClick: (event: MouseEvent) => void;
  /** Start disabled (e.g. undo/redo before history exists). */
  disabled?: boolean;
  /** Toggle buttons: initial aria-pressed value. */
  pressed?: boolean;
  /** Extra ARIA attributes, e.g. `{ 'aria-haspopup': 'true' }`. */
  aria?: Record<string, string>;
}

/**
 * The shared control-button shell: `<button type=button>` with a title,
 * an `.emap-ctrl-icon` span wrapping the icon, and a click listener.
 */
export function createControlButton(options: ControlButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = options.className;
  btn.type = 'button';
  btn.title = options.title;
  if (options.disabled) btn.disabled = true;
  if (options.pressed !== undefined) btn.setAttribute('aria-pressed', String(options.pressed));
  for (const [name, value] of Object.entries(options.aria ?? {})) {
    btn.setAttribute(name, value);
  }
  const icon = document.createElement('span');
  icon.className = 'emap-ctrl-icon';
  if (typeof options.icon === 'string') icon.textContent = options.icon;
  else icon.appendChild(options.icon);
  btn.appendChild(icon);
  btn.addEventListener('click', options.onClick);
  return btn;
}
