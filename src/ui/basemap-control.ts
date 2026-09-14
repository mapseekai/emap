import type {
  MapLibreBasemapService,
  MapLibreServiceErrorEvent,
  MapLibreServiceManager,
} from '../integrations/maplibre/maplibre-service';
import type { ControlContext } from '../runtime/services/controls';
import type { Control } from './control';
import { createControlButton, createControlIcon } from './control-icons';

export interface BasemapStyle {
  name: string;
  url: string;
  type?: 'vector' | 'raster';
}

export interface BasemapOptions {
  styles?: BasemapStyle[];
  defaultStyle?: string;
}

const DEFAULT_STYLES: BasemapStyle[] = [
  {
    name: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    type: 'raster',
  },
  {
    name: 'CartoDB Light',
    url: 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    type: 'raster',
  },
  {
    name: 'CartoDB Dark',
    url: 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
    type: 'raster',
  },
];

const MAPLIBRE_TILE_SIZE = 512;
const LEGACY_ID_PREFIX = 'emap-legacy-basemap-';

let basemapControlSequence = 0;

function toLegacyBasemapService(style: BasemapStyle, index: number): MapLibreBasemapService {
  const mapLibreStyle: MapLibreBasemapService['style'] =
    style.type === 'raster' || style.url.includes('{z}')
      ? {
          version: 8,
          sources: {
            'basemap-tiles': {
              type: 'raster',
              tiles: [style.url],
              tileSize: MAPLIBRE_TILE_SIZE,
            },
          },
          layers: [
            {
              id: 'basemap-layer',
              type: 'raster',
              source: 'basemap-tiles',
              minzoom: 0,
              maxzoom: 22,
            },
          ],
        }
      : style.url;

  return {
    id: `${LEGACY_ID_PREFIX}${index}`,
    name: style.name,
    role: 'basemap',
    style: mapLibreStyle,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError';
}

export class BasemapControl implements Control {
  readonly inject = ['mapLibre'];

  private readonly _legacyStyles: readonly BasemapStyle[];
  private readonly _defaultStyle: string | undefined;
  private readonly _hasLegacyOptions: boolean;
  private readonly _instanceId: number;
  private _manager: MapLibreServiceManager | null = null;
  private _container: HTMLElement | null = null;
  private _trigger: HTMLButtonElement | null = null;
  private _panel: HTMLElement | null = null;
  private _radioGroup: HTMLElement | null = null;
  private _status: HTMLElement | null = null;

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

  private readonly _handleRadioChange = (event: Event): void => {
    const radio = event.target;
    if (!(radio instanceof HTMLInputElement) || radio.type !== 'radio' || !radio.checked) return;
    this._selectBasemap(radio.value);
  };

  private readonly _handleRadioKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._setOpen(false);
      this._trigger?.focus();
      return;
    }

    const current = event.target;
    if (!(current instanceof HTMLInputElement) || current.type !== 'radio') return;
    const radios = this._getRadios();
    const currentIndex = radios.indexOf(current);
    if (currentIndex === -1) return;

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % radios.length;
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + radios.length) % radios.length;
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = radios.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const next = radios[nextIndex];
    next.focus();
    this._selectBasemap(next.value);
  };

  private readonly _handleDocumentMouseDown = (event: MouseEvent): void => {
    if (this._container && !this._container.contains(event.target as Node)) {
      this._setOpen(false);
    }
  };

  constructor(options: BasemapOptions = {}) {
    this._hasLegacyOptions =
      Object.hasOwn(options, 'styles') || Object.hasOwn(options, 'defaultStyle');
    this._legacyStyles = Object.hasOwn(options, 'styles')
      ? (options.styles ?? DEFAULT_STYLES)
      : DEFAULT_STYLES;
    this._defaultStyle = options.defaultStyle;
    this._instanceId = ++basemapControlSequence;
  }

  onAdd(map: ControlContext): HTMLElement {
    const manager = map.mapLibreServices;
    const registeredServices = manager.getServices();
    if (this._hasLegacyOptions && registeredServices.length > 0) {
      throw new Error(
        'BasemapControl legacy options conflict with the existing MapLibre service registry',
      );
    }

    this._manager = manager;
    this._createDom();
    manager.on('change', this._handleManagerChange);
    manager.on('error', this._handleManagerError);
    document.addEventListener('mousedown', this._handleDocumentMouseDown);

    if (registeredServices.length === 0) this._registerLegacyStyles();
    this._render();
    return this._container!;
  }

  isOn(): boolean {
    if (!this._manager) return false;
    return this._manager
      .getServices()
      .some(
        (service) =>
          service.role === 'basemap' && this._manager?.getServiceState(service.id)?.active === true,
      );
  }

  onRemove(): void {
    this._manager?.off('change', this._handleManagerChange);
    this._manager?.off('error', this._handleManagerError);
    document.removeEventListener('mousedown', this._handleDocumentMouseDown);
    this._trigger?.removeEventListener('click', this._handleTriggerClick);
    this._radioGroup?.removeEventListener('change', this._handleRadioChange);
    this._radioGroup?.removeEventListener('keydown', this._handleRadioKeydown);
    this._container?.remove();

    this._manager = null;
    this._container = null;
    this._trigger = null;
    this._panel = null;
    this._radioGroup = null;
    this._status = null;
  }

  private _createDom(): void {
    const panelId = `emap-basemap-panel-${this._instanceId}`;

    this._container = document.createElement('div');
    this._container.className = 'emap-ctrl emap-panel-control emap-basemap-ctrl';

    this._trigger = createControlButton({
      className: 'emap-panel-trigger emap-basemap-trigger',
      title: 'Basemap',
      icon: createControlIcon('basemap'),
      onClick: this._handleTriggerClick,
      aria: {
        'aria-label': 'Basemap',
        'aria-haspopup': 'true',
        'aria-expanded': 'false',
        'aria-controls': panelId,
      },
    });

    this._panel = document.createElement('div');
    this._panel.id = panelId;
    this._panel.className = 'emap-control-panel emap-basemap-panel';
    this._panel.hidden = true;
    this._panel.setAttribute('aria-busy', 'false');

    this._radioGroup = document.createElement('div');
    this._radioGroup.className = 'emap-control-group emap-basemap-options';
    this._radioGroup.setAttribute('role', 'radiogroup');
    this._radioGroup.setAttribute('aria-label', 'Basemap');
    this._radioGroup.addEventListener('change', this._handleRadioChange);
    this._radioGroup.addEventListener('keydown', this._handleRadioKeydown);

    this._status = document.createElement('div');
    this._status.className = 'emap-control-status emap-basemap-status';
    this._status.hidden = true;
    this._status.setAttribute('role', 'status');
    this._status.setAttribute('aria-live', 'polite');
    this._status.setAttribute('aria-atomic', 'true');

    this._panel.append(this._radioGroup, this._status);
    this._container.append(this._trigger, this._panel);
  }

  private _registerLegacyStyles(): void {
    if (!this._manager) return;
    const services = this._legacyStyles.map(toLegacyBasemapService);
    const registration = Promise.all(services.map((service) => this._manager!.addService(service)));
    const defaultIndex = this._legacyStyles.findIndex((style) => style.name === this._defaultStyle);
    const operation =
      defaultIndex === -1
        ? registration
        : registration.then(() => this._manager?.setBasemap(`${LEGACY_ID_PREFIX}${defaultIndex}`));
    this._observeManagerOperation(operation);
  }

  private _render(transientError?: Error): void {
    if (!this._manager || !this._panel || !this._radioGroup || !this._status) return;

    const focusedValue = this._radioGroup.contains(document.activeElement)
      ? (document.activeElement as HTMLInputElement).value
      : undefined;
    const basemaps = this._manager
      .getServices()
      .filter((service): service is MapLibreBasemapService => service.role === 'basemap');
    const states = new Map(
      basemaps.map((service) => [service.id, this._manager!.getServiceState(service.id)]),
    );
    const activeBasemap = basemaps.find((service) => states.get(service.id)?.active === true);
    const activeState = activeBasemap ? states.get(activeBasemap.id) : undefined;
    const erroredBasemap = basemaps.find((service) => states.get(service.id)?.status === 'error');
    const errorState = erroredBasemap ? states.get(erroredBasemap.id) : undefined;

    const choices: Array<{ id: string; name: string }> = [
      { id: '', name: 'No basemap' },
      ...basemaps.map((service) => ({ id: service.id, name: service.name })),
    ];
    const groupName = `emap-basemap-choice-${this._instanceId}`;
    const rows = choices.map((choice, index) => {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = groupName;
      input.id = `${groupName}-${index}`;
      input.value = choice.id;
      input.checked = choice.id === (activeBasemap?.id ?? '');

      const label = document.createElement('label');
      label.className = 'emap-control-row emap-basemap-row';
      label.htmlFor = input.id;
      label.append(input, document.createTextNode(choice.name));
      return label;
    });
    this._radioGroup.replaceChildren(...rows);

    const loading = activeState?.status === 'loading';
    this._panel.setAttribute('aria-busy', String(loading));
    let statusMessage = '';
    if (transientError) {
      statusMessage = `Basemap error: ${transientError.message}`;
    } else if (activeBasemap && activeState?.status === 'loading') {
      statusMessage = `Loading ${activeBasemap.name}…`;
    } else if (erroredBasemap) {
      statusMessage = `${erroredBasemap.name}: ${errorState?.error?.message ?? 'Basemap error'}`;
    }
    this._status.textContent = statusMessage;
    this._status.hidden = statusMessage === '';

    if (focusedValue !== undefined && !this._panel.hidden) {
      this._getRadios()
        .find((radio) => radio.value === focusedValue)
        ?.focus();
    }
  }

  private _getRadios(): HTMLInputElement[] {
    return this._radioGroup
      ? [...this._radioGroup.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
      : [];
  }

  private _selectBasemap(value: string): void {
    if (!this._manager) return;
    this._observeManagerOperation(this._manager.setBasemap(value || null));
  }

  private _observeManagerOperation(operation: Promise<unknown>): void {
    void operation.catch((error: unknown) => {
      if (!isAbortError(error)) console.error(error);
    });
  }

  private _setOpen(open: boolean): void {
    if (!this._panel || !this._trigger) return;
    this._panel.hidden = !open;
    this._trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      this._render();
      const selected = this._getRadios().find((radio) => radio.checked);
      (selected ?? this._getRadios()[0])?.focus();
    }
  }
}
