import type { Emap } from '../map/map';
import type { LayerSpecification } from '../map/layer';
import type {
  MapLibreOverlayService,
  MapLibreOverlayServiceBase,
  MapLibreServiceErrorEvent,
  MapLibreServiceManager,
} from '../map/maplibre-service';
import type { Control } from './control';
import { createControlIcon } from './control-icons';

let layerControlSequence = 0;

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export class LayerControl implements Control {
  private readonly _instanceId = ++layerControlSequence;
  private _map: Emap | null = null;
  private _manager: MapLibreServiceManager | null = null;
  private _container: HTMLElement | null = null;
  private _trigger: HTMLButtonElement | null = null;
  private _panel: HTMLElement | null = null;
  private _businessGroup: HTMLElement | null = null;
  private _onlineGroup: HTMLElement | null = null;
  private _status: HTMLElement | null = null;

  private readonly _handleLayerChange = (): void => {
    this._render();
  };

  private readonly _handleManagerChange = (): void => {
    this._render();
  };

  private readonly _handleManagerError = (
    event: { type: 'error' } & MapLibreServiceErrorEvent,
  ): void => {
    this._render(event.error);
  };

  private readonly _handleTriggerClick = (): void => {
    this._setOpen(this._panel?.hidden ?? true);
  };

  private readonly _handleCheckboxChange = (event: Event): void => {
    const checkbox = event.target;
    if (!(checkbox instanceof HTMLInputElement) || checkbox.type !== 'checkbox') return;

    if (checkbox.dataset.layerKind === 'business') {
      this._map?.setLayerVisibility(checkbox.value, checkbox.checked ? 'visible' : 'none');
      return;
    }

    if (checkbox.dataset.layerKind === 'online' && this._manager) {
      void this._manager.setOverlayVisibility(checkbox.value, checkbox.checked).catch((error) => {
        if (!isAbortError(error)) console.error(error);
      });
    }
  };

  private readonly _handlePanelKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this._setOpen(false);
    this._trigger?.focus();
  };

  private readonly _handleDocumentMouseDown = (event: MouseEvent): void => {
    if (this._container && !this._container.contains(event.target as Node)) {
      this._setOpen(false);
    }
  };

  onAdd(map: Emap): HTMLElement {
    this._map = map;
    this._manager = map.mapLibreServices;
    this._createDom();

    map.on('layerchange', this._handleLayerChange);
    this._manager.on('change', this._handleManagerChange);
    this._manager.on('error', this._handleManagerError);
    document.addEventListener('mousedown', this._handleDocumentMouseDown);

    this._render();
    return this._container!;
  }

  onRemove(): void {
    this._map?.off('layerchange', this._handleLayerChange);
    this._manager?.off('change', this._handleManagerChange);
    this._manager?.off('error', this._handleManagerError);
    document.removeEventListener('mousedown', this._handleDocumentMouseDown);
    this._trigger?.removeEventListener('click', this._handleTriggerClick);
    this._panel?.removeEventListener('change', this._handleCheckboxChange);
    this._panel?.removeEventListener('keydown', this._handlePanelKeydown);
    this._container?.remove();

    this._map = null;
    this._manager = null;
    this._container = null;
    this._trigger = null;
    this._panel = null;
    this._businessGroup = null;
    this._onlineGroup = null;
    this._status = null;
  }

  private _createDom(): void {
    const panelId = `emap-layer-panel-${this._instanceId}`;

    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-panel-control emap-layer-control';

    this._trigger = document.createElement('button');
    this._trigger.type = 'button';
    this._trigger.className = 'emap-panel-trigger emap-layer-trigger';
    this._trigger.title = 'Layers';
    this._trigger.setAttribute('aria-label', 'Layers');
    const icon = document.createElement('span');
    icon.className = 'emap-ctrl-icon';
    icon.appendChild(createControlIcon('layers'));
    this._trigger.appendChild(icon);
    this._trigger.setAttribute('aria-haspopup', 'dialog');
    this._trigger.setAttribute('aria-expanded', 'false');
    this._trigger.setAttribute('aria-controls', panelId);
    this._trigger.addEventListener('click', this._handleTriggerClick);

    this._panel = document.createElement('div');
    this._panel.id = panelId;
    this._panel.className = 'emap-control-panel emap-layer-panel';
    this._panel.hidden = true;
    this._panel.tabIndex = -1;
    this._panel.setAttribute('role', 'dialog');
    this._panel.setAttribute('aria-label', 'Layers');
    this._panel.setAttribute('aria-busy', 'false');
    this._panel.addEventListener('change', this._handleCheckboxChange);
    this._panel.addEventListener('keydown', this._handlePanelKeydown);

    this._businessGroup = this._createGroup('Business layers', 'emap-layer-group--business');
    this._onlineGroup = this._createGroup('Online overlays', 'emap-layer-group--online');

    this._status = document.createElement('div');
    this._status.className = 'emap-control-status emap-layer-status';
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');
    this._status.setAttribute('aria-atomic', 'true');

    this._panel.append(this._businessGroup, this._onlineGroup, this._status);
    this._container.append(this._trigger, this._panel);
  }

  private _createGroup(label: string, modifier: string): HTMLElement {
    const group = document.createElement('div');
    group.className = `emap-control-group emap-layer-group ${modifier}`;
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);

    const title = document.createElement('div');
    title.className = 'emap-layer-group-title';
    title.textContent = label;
    title.setAttribute('aria-hidden', 'true');
    group.append(title);
    return group;
  }

  private _render(transientError?: Error): void {
    if (
      !this._map ||
      !this._manager ||
      !this._panel ||
      !this._businessGroup ||
      !this._onlineGroup ||
      !this._status
    ) {
      return;
    }

    const focused = this._focusedCheckbox();
    const businessLayers = this._map.getRenderedLayers();
    const overlays = this._manager
      .getServices()
      .filter((service): service is MapLibreOverlayService => service.role === 'overlay');

    this._businessGroup.replaceChildren(
      this._groupTitle('Business layers'),
      ...businessLayers.map((layer, index) => this._businessRow(layer, index)),
    );
    this._onlineGroup.replaceChildren(
      this._groupTitle('Online overlays'),
      ...overlays.map((service, index) => this._onlineRow(service, index)),
    );

    const loading = overlays.filter(
      (service) => this._manager?.getServiceState(service.id)?.status === 'loading',
    );
    const errored = overlays.find(
      (service) => this._manager?.getServiceState(service.id)?.status === 'error',
    );
    const stateError = errored ? this._manager.getServiceState(errored.id)?.error : undefined;
    const hasError = transientError !== undefined || errored !== undefined;

    this._panel.setAttribute('aria-busy', String(loading.length > 0));
    this._status.classList.toggle('emap-control-status--loading', loading.length > 0 && !hasError);
    this._status.classList.toggle('emap-control-status--error', hasError);
    if (transientError) {
      this._status.textContent = `Layer error: ${transientError.message}`;
    } else if (errored) {
      this._status.textContent = `${errored.name}: ${stateError?.message ?? 'Overlay error'}`;
    } else if (loading.length > 0) {
      this._status.textContent = `Loading ${loading.map((service) => service.name).join(', ')}…`;
    } else {
      this._status.textContent = `${businessLayers.length} business layers, ${overlays.length} online overlays`;
    }

    if (focused && !this._panel.hidden) {
      this._getCheckboxes()
        .find(
          (checkbox) =>
            checkbox.value === focused.value &&
            checkbox.dataset.layerKind === focused.dataset.layerKind,
        )
        ?.focus();
    }
  }

  private _groupTitle(text: string): HTMLElement {
    const title = document.createElement('div');
    title.className = 'emap-layer-group-title';
    title.textContent = text;
    title.setAttribute('aria-hidden', 'true');
    return title;
  }

  private _businessRow(layer: LayerSpecification, index: number): HTMLLabelElement {
    return this._checkboxRow(
      layer.id,
      layer.id,
      layer.layout?.visibility !== 'none',
      'business',
      index,
    );
  }

  private _onlineRow(service: MapLibreOverlayServiceBase, index: number): HTMLLabelElement {
    return this._checkboxRow(
      service.id,
      service.name,
      this._manager?.getServiceState(service.id)?.active === true,
      'online',
      index,
    );
  }

  private _checkboxRow(
    value: string,
    labelText: string,
    checked: boolean,
    kind: 'business' | 'online',
    index: number,
  ): HTMLLabelElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.id = `emap-layer-${this._instanceId}-${kind}-${index}`;
    input.value = value;
    input.checked = checked;
    input.dataset.layerKind = kind;

    const label = document.createElement('label');
    label.className = 'emap-control-row emap-layer-row';
    label.htmlFor = input.id;
    label.append(input, document.createTextNode(labelText));
    return label;
  }

  private _focusedCheckbox(): HTMLInputElement | null {
    const active = document.activeElement;
    return active instanceof HTMLInputElement && this._panel?.contains(active) ? active : null;
  }

  private _getCheckboxes(): HTMLInputElement[] {
    return this._panel
      ? [...this._panel.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      : [];
  }

  private _setOpen(open: boolean): void {
    if (!this._panel || !this._trigger) return;
    this._panel.hidden = !open;
    this._trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      this._render();
      (this._getCheckboxes()[0] ?? this._panel).focus();
    }
  }
}
