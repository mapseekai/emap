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

import { Control } from './control';
import type { Emap } from '../map/map';
import type { SimplifyMethod } from '../map/types';

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
  private _map: Emap | null = null;
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

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-ctrl-group emap-ctrl-simplify-wrap';

    this._btn = document.createElement('button');
    this._btn.type = 'button';
    this._btn.className = 'emap-ctrl-simplify';
    this._btn.innerHTML = '<span class="emap-ctrl-icon">≈</span>';
    this._btn.title = this._opts.title ?? 'Simplify geometry';
    this._btn.setAttribute('aria-expanded', 'false');
    this._btn.onclick = (e) => {
      e.stopPropagation();
      this._togglePopup();
    };
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

    const percentage = this._opts.initialPercentage ?? 10;
    const method = this._opts.initialMethod ?? '';

    popup.innerHTML = `
      <div class="emap-simplify-field">
        <label class="emap-simplify-label">
          <span>Percentage:</span>
          <input class="emap-simplify-range" type="range" min="0" max="100" step="0.1" value="${percentage}" />
          <span class="emap-simplify-value value">${percentage}%</span>
        </label>
      </div>
      <div class="emap-simplify-field">
        <label class="emap-simplify-label">
          <span>Method:</span>
          <select class="emap-simplify-select">
            ${METHODS.map((m) => `<option value="${m.value}"${m.value === method ? ' selected' : ''}>${m.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="emap-simplify-flags">
        <label><input type="checkbox" data-flag="keep-shapes" checked /> keep-shapes</label>
        <label><input type="checkbox" data-flag="planar" /> planar</label>
      </div>
      <div class="emap-simplify-actions">
        <button type="button" class="emap-simplify-apply apply">Apply</button>
        <span class="emap-simplify-status status"></span>
      </div>
    `;

    this._percentageInput = popup.querySelector('input[type=range]') as HTMLInputElement;
    this._percentageLabel = popup.querySelector('.value') as HTMLElement;
    this._methodSel = popup.querySelector('select') as HTMLSelectElement;
    this._keepShapes = popup.querySelector('input[data-flag=keep-shapes]') as HTMLInputElement;
    this._planar = popup.querySelector('input[data-flag=planar]') as HTMLInputElement;
    this._applyBtn = popup.querySelector('button.apply') as HTMLButtonElement;
    this._statusEl = popup.querySelector('.status') as HTMLElement;

    this._percentageInput.oninput = () => {
      if (this._percentageLabel && this._percentageInput) {
        this._percentageLabel.textContent = `${this._percentageInput.value}%`;
      }
    };

    this._applyBtn.onclick = () => this._apply();

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
