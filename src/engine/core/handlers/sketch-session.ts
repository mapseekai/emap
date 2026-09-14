import type { HandlerResult, NormalizedPointerEvent } from '../handler';
import type { DrawOverlaySnapKind } from '../../rendering/painter';
import { EMAP_THEME_COLORS } from '../../../ui/theme/colors';
import type { EditHandlerHost } from './edit-handler-host';

export interface SketchSnapTarget {
  coord: [number, number];
  kind: DrawOverlaySnapKind;
}

export interface SketchSessionOptions {
  minVertices: number;
  autoFinishAt?: number;
  closeRing?: boolean;
  drawColor?: string;
  resolveSnap?: (px: number, py: number) => SketchSnapTarget | null;
  canPlace?: (snap: SketchSnapTarget | null) => boolean;
}

export class SketchSession {
  private _vertices: [number, number][] = [];
  private _cursorCoord: [number, number] | null = null;
  private _snapCoord: [number, number] | null = null;
  private _snapKind: DrawOverlaySnapKind = null;
  private _overlayPublished = false;

  constructor(
    private readonly _host: EditHandlerHost,
    private readonly _opts: SketchSessionOptions,
    private readonly _onFinish: (vertices: [number, number][]) => void,
  ) {}

  get vertexCount(): number {
    return this._vertices.length;
  }

  handlePointer(ev: NormalizedPointerEvent): HandlerResult {
    if (ev.kind === 'move') {
      this._updateCursor(ev.point.x, ev.point.y);
      return 'passthrough';
    }
    if (ev.kind === 'click') {
      if (ev.button !== 0) return 'passthrough';
      const cursor = this._host.unproject(ev.point.x, ev.point.y);
      this._cursorCoord = [cursor[0], cursor[1]];
      if (
        this._opts.canPlace?.(
          this._snapCoord === null ? null : { coord: this._snapCoord, kind: this._snapKind },
        ) === false
      )
        return 'consumed';
      const coord = this._snapCoord ?? this._cursorCoord;
      if (!coord) return 'consumed';
      this._vertices.push([coord[0], coord[1]]);
      if (this._opts.autoFinishAt !== undefined && this._vertices.length >= this._opts.autoFinishAt)
        this._finish();
      else this._refreshOverlay();
      return 'consumed';
    }
    if (ev.kind === 'contextmenu') {
      ev.originalEvent.preventDefault();
      if (this._vertices.length >= this._opts.minVertices) this._finish();
      else {
        this.clear();
        this._host.render();
      }
      return 'consumed';
    }
    return 'passthrough';
  }

  handleKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    this.clear();
    this._host.render();
  }

  clear(): void {
    this._vertices = [];
    this._cursorCoord = null;
    this._snapCoord = null;
    this._snapKind = null;
    this._overlayPublished = false;
    this._host.clearEditDrawState();
  }

  private _updateCursor(px: number, py: number): void {
    const cursor = this._host.unproject(px, py);
    this._cursorCoord = [cursor[0], cursor[1]];
    const snap = this._opts.resolveSnap?.(px, py) ?? null;
    this._snapCoord = snap?.coord ?? null;
    this._snapKind = snap?.kind ?? null;
    this._refreshOverlay();
  }

  private _finish(): void {
    const vertices = this._vertices.map(([x, y]) => [x, y] as [number, number]);
    if (this._opts.closeRing && vertices.length > 0) {
      const first = vertices[0]!;
      const last = vertices.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1]) vertices.push([first[0], first[1]]);
    }
    this._onFinish(vertices);
    this.clear();
    this._host.render();
  }

  private _refreshOverlay(): void {
    if (this._vertices.length === 0 && !this._snapCoord) {
      if (this._overlayPublished) {
        this._overlayPublished = false;
        this._host.clearEditDrawState();
      }
      return;
    }
    this._overlayPublished = true;
    this._host.setEditDrawState({
      vertices: this._vertices.map(([x, y]) => [x, y] as [number, number]),
      cursorCoord: this._snapCoord ?? this._cursorCoord,
      snapCoord: this._snapCoord,
      snapKind: this._snapKind,
      geometryType: 'polyline',
      drawColor: this._opts.drawColor ?? EMAP_THEME_COLORS.primary,
    });
  }
}
