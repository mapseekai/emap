// SimplifyControl — toolbar button that opens a small popup for running
// `emap.ops.simplifyLayer` on a configured source. The popup exposes the
// most useful parameters (percentage slider + method dropdown + flags).
// "Apply" fires one simplify op (a single undoable history entry); the
// slider does NOT live-preview — it only sets the value that Apply will
// use, so the undo stack stays clean.
//
// Construction:
//   new SimplifyControl({ source: 's1' })                  // simplify whole source
//   new SimplifyControl({ source: 's1', target: 'parks' }) // simplify single layer

import type { SimplifyMethod } from '../engine/map/types';
import type { ControlContext } from '../runtime/services/controls';
import { Control } from './control';
import { createControlButton, createControlIcon } from './control-icons';

export interface SimplifyControlOptions {
  /** Source ID to simplify. Required. */
  source: string;
  /** Optional layer name — when omitted, the whole source dataset is simplified. */
  target?: string;
  /** Initial slider value, 0–100. Default 10 (= keep 10% of vertices). */
  initialPercentage?: number;
  /** Initial method. Default 'weighted'. */
  initialMethod?: SimplifyMethod;
  /** Button tooltip override. */
  title?: string;
}

const METHODS: Array<{ value: '' | SimplifyMethod; label: string }> = [
  { value: '', label: 'weighted (default)' },
  { value: 'weighted', label: 'weighted' },
  { value: 'visvalingam', label: 'visvalingam' },
  { value: 'dp', label: 'dp (Douglas–Peucker)' },
];

export class SimplifyControl implements Control {
  private _opts: SimplifyControlOptions;
  private _map: ControlContext | null = null;
  private _container: HTMLElement | null = null;
  private _btn: HTMLButtonElement | null = null;
  private _popup: HTMLElement | null = null;
  private _percentageInput: HTMLInputElement | null = null;
  private _percentageLabel: HTMLElement | null = null;
  private _methodSel: HTMLSelectElement | null = null;
  private _keepShapes: HTMLInputElement | null = null;
  private _planar: HTMLInputElement | null = null;
  private _applyBtn: HTMLButtonElement | null = null;
  private _statusEl: HTMLElement | null = null;
  private _onDocClick: ((e: MouseEvent) => void) | null = null;
  private _onDocKey: ((e: KeyboardEvent) => void) | null = null;

  constructor(opts: SimplifyControlOptions) {
    this._opts = opts;
  }

  onAdd(map: ControlContext): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group emap-ctrl-simplify-wrap';

    this._btn = createControlButton({
      className: 'emap-ctrl-simplify',
      title: this._opts.title ?? 'Simplify geometry',
      icon: createControlIcon('simplify'),
      onClick: (e) => {
        e.stopPropagation();
        this._togglePopup();
      },
      aria: { 'aria-expanded': 'false' },
    });
    this._container.appendChild(this._btn);

    this._popup = this._buildPopup();
    this._container.appendChild(this._popup);

    return this._container;
  }

  onRemove(): void {
    this._teardownDocListeners();
    if (this._container?.parentNode) {
      this._container.parentNode.removeChild(this._container);
    }
    this._container = null;
    this._btn = null;
    this._popup = null;
    this._percentageInput = null;
    this._percentageLabel = null;
    this._methodSel = null;
    this._keepShapes = null;
    this._planar = null;
    this._applyBtn = null;
    this._statusEl = null;
    this._map = null;
  }

  private _buildPopup(): HTMLElement {
    const popup = document.createElement('div');
    popup.className = 'emap-simplify-popup';
    popup.style.display = 'none';
    popup.onclick = (e) => e.stopPropagation();

    const configuredPercentage = this._opts.initialPercentage;
    const percentage =
      typeof configuredPercentage === 'number' && Number.isFinite(configuredPercentage)
        ? Math.min(100, Math.max(0, configuredPercentage))
        : 10;
    const configuredMethod = this._opts.initialMethod;
    const method = METHODS.some((option) => option.value === configuredMethod)
      ? (configuredMethod ?? '')
      : '';

    const percentageField = document.createElement('div');
    percentageField.className = 'emap-simplify-field';
    const percentageControl = document.createElement('label');
    percentageControl.className = 'emap-simplify-label';
    const percentageTitle = document.createElement('span');
    percentageTitle.textContent = 'Percentage:';
    const percentageInput = document.createElement('input');
    percentageInput.className = 'emap-simplify-range';
    percentageInput.type = 'range';
    percentageInput.min = '0';
    percentageInput.max = '100';
    percentageInput.step = '0.1';
    percentageInput.value = String(percentage);
    const percentageLabel = document.createElement('span');
    percentageLabel.className = 'emap-simplify-value value';
    percentageLabel.textContent = `${percentage}%`;
    percentageControl.append(percentageTitle, percentageInput, percentageLabel);
    percentageField.appendChild(percentageControl);

    const methodField = document.createElement('div');
    methodField.className = 'emap-simplify-field';
    const methodControl = document.createElement('label');
    methodControl.className = 'emap-simplify-label';
    const methodTitle = document.createElement('span');
    methodTitle.textContent = 'Method:';
    const methodSelect = document.createElement('select');
    methodSelect.className = 'emap-simplify-select';
    for (const optionDefinition of METHODS) {
      const option = document.createElement('option');
      option.value = optionDefinition.value;
      option.textContent = optionDefinition.label;
      option.selected = optionDefinition.value === method;
      methodSelect.appendChild(option);
    }
    methodControl.append(methodTitle, methodSelect);
    methodField.appendChild(methodControl);

    const flags = document.createElement('div');
    flags.className = 'emap-simplify-flags';
    const keepShapesLabel = document.createElement('label');
    const keepShapes = document.createElement('input');
    keepShapes.type = 'checkbox';
    keepShapes.dataset.flag = 'keep-shapes';
    keepShapes.checked = true;
    keepShapesLabel.append(keepShapes, document.createTextNode(' keep-shapes'));
    const planarLabel = document.createElement('label');
    const planar = document.createElement('input');
    planar.type = 'checkbox';
    planar.dataset.flag = 'planar';
    planarLabel.append(planar, document.createTextNode(' planar'));
    flags.append(keepShapesLabel, planarLabel);

    const actions = document.createElement('div');
    actions.className = 'emap-simplify-actions';
    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.className = 'emap-simplify-apply apply';
    applyButton.textContent = 'Apply';
    const status = document.createElement('span');
    status.className = 'emap-simplify-status status';
    actions.append(applyButton, status);

    popup.append(percentageField, methodField, flags, actions);

    this._percentageInput = percentageInput;
    this._percentageLabel = percentageLabel;
    this._methodSel = methodSelect;
    this._keepShapes = keepShapes;
    this._planar = planar;
    this._applyBtn = applyButton;
    this._statusEl = status;

    percentageInput.oninput = () => {
      if (this._percentageLabel && this._percentageInput) {
        this._percentageLabel.textContent = `${this._percentageInput.value}%`;
      }
    };

    applyButton.onclick = () => this._apply();

    return popup;
  }

  private _togglePopup(): void {
    if (!this._popup) return;
    const open = this._popup.style.display === 'none';
    this._popup.style.display = open ? 'block' : 'none';
    this._btn?.classList.toggle('active', open);
    this._btn?.setAttribute('aria-expanded', String(open));
    if (open) {
      this._setupDocListeners();
      this._setStatus('');
    } else {
      this._teardownDocListeners();
    }
  }

  private _setupDocListeners(): void {
    this._onDocClick = (e) => {
      if (this._container && !this._container.contains(e.target as Node)) {
        this._togglePopup();
      }
    };
    this._onDocKey = (e) => {
      if (e.key === 'Escape') this._togglePopup();
    };
    document.addEventListener('mousedown', this._onDocClick);
    document.addEventListener('keydown', this._onDocKey);
  }

  private _teardownDocListeners(): void {
    if (this._onDocClick) document.removeEventListener('mousedown', this._onDocClick);
    if (this._onDocKey) document.removeEventListener('keydown', this._onDocKey);
    this._onDocClick = null;
    this._onDocKey = null;
  }

  private _setStatus(msg: string): void {
    if (this._statusEl) this._statusEl.textContent = msg;
  }

  private async _apply(): Promise<void> {
    if (!this._map || !this._percentageInput || !this._methodSel) return;

    const percentage = Number(this._percentageInput.value);
    const method = this._methodSel.value;

    const opts: Record<string, unknown> = {
      source: this._opts.source,
      percentage,
    };
    if (this._opts.target) opts.target = this._opts.target;
    if (method) opts.method = method;
    if (this._keepShapes?.checked) opts.keepShapes = true;
    if (this._planar?.checked) opts.planar = true;

    if (this._applyBtn) this._applyBtn.disabled = true;
    this._setStatus('Running…');

    try {
      const result = await (this._map.ops as any).simplifyLayer(opts);
      if (result?.ok) {
        this._setStatus(`Simplified at ${percentage}%`);
      } else {
        const e = result?.error;
        const detail = e ? `${e.kind}${e.field ? ' field=' + e.field : ''}` : 'unknown';
        this._setStatus(`Failed: ${detail}`);
      }
    } catch (err: any) {
      this._setStatus(`Error: ${err?.message ?? err}`);
    } finally {
      if (this._applyBtn) this._applyBtn.disabled = false;
    }
  }
}
