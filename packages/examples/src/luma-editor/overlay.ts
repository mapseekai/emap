import { lineGeometry, pointGeometry } from '../../../../src/engine/rendering/luma/geometry';
import { GpuRenderer, type GpuMesh } from '../../../../src/integrations/luma/gpu-renderer';
import { LumaEditSession } from '../../../../src/engine/rendering/luma/edit-session';
import type { AffineTransform } from '../../../../src/domain/geo/transform';

/** Original-geometry highlight and edit handles share the base luma RenderPass. */
export class EditorOverlay {
  private outline: GpuMesh | null = null;
  private handles: GpuMesh | null = null;
  private preview: GpuMesh | null = null;
  private active: GpuMesh | null = null;
  private token = '';
  private previewToken = '';
  private viewToken = '';
  visibleHandles = 0;
  constructor(private gpu: GpuRenderer) {}
  private replace(key: 'outline' | 'handles' | 'preview' | 'active', mesh: GpuMesh | null): void {
    if (this[key]) this.gpu.destroyMesh(this[key]!);
    this[key] = mesh;
  }
  update(
    session: LumaEditSession,
    view: AffineTransform,
    width: number,
    height: number,
    editing: boolean,
  ): void {
    const ref = session.selected;
    const token = `${ref?.layer}:${ref?.id}:${session.dataset.editVersion ?? 0}`;
    if (this.token !== token) {
      this.token = token;
      this.viewToken = '';
      this.previewToken = '';
      this.replace('outline', this.gpu.createMesh(lineGeometry(session.paths())));
    }
    const viewToken = `${token}:${view.mx},${view.my},${view.bx},${view.by}:${width}:${height}:${editing}`;
    if (this.viewToken !== viewToken) {
      this.viewToken = viewToken;
      const points = session.vertexHandles
        .filter((h) => {
          const [x, y] = view.project(...h.position);
          return x >= -10 && x <= width + 10 && y >= -10 && y <= height + 10;
        })
        .map((h) => h.position);
      this.visibleHandles = points.length;
      this.replace('handles', this.gpu.createMesh(pointGeometry(points)));
    }
    const draft = session.draft;
    const previewToken = draft ? draft.to.join(',') : 'none';
    if (previewToken !== this.previewToken) {
      this.previewToken = previewToken;
      this.replace('preview', this.gpu.createMesh(lineGeometry(session.previewPaths())));
      this.replace('active', this.gpu.createMesh(pointGeometry(draft ? [draft.to] : [])));
    }
  }
  draw(editing: boolean, isPoint: boolean): void {
    if (this.outline) this.gpu.drawMesh(this.outline, { color: [1, 0.38, 0, 1], width: 2 });
    if (this.handles && (editing || isPoint)) {
      this.gpu.drawMesh(this.handles, { color: [1, 1, 1, 1], radius: editing ? 4 : 7 });
      this.gpu.drawMesh(this.handles, {
        color: [1, 0.38, 0, 1],
        radius: editing ? 4 : 7,
        filled: false,
        width: 1.5,
      });
    }
    if (this.preview) this.gpu.drawMesh(this.preview, { color: [0.9, 0.08, 0.13, 1], width: 2.5 });
    if (this.active) this.gpu.drawMesh(this.active, { color: [0.9, 0.08, 0.13, 1], radius: 6 });
  }
  clear(): void {
    for (const key of ['outline', 'handles', 'preview', 'active'] as const) this.replace(key, null);
    this.token = this.previewToken = this.viewToken = '';
  }
}
