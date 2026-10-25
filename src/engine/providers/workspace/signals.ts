import type { EventDispatcher } from '../../core/events';
import type { AffineDelta, RenderAction } from '../../map/types';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';

/** A render invalidation port: data services never depend on a renderer implementation. */
export class RenderSignals {
  constructor(
    private readonly events: EventDispatcher,
    private readonly document: Pick<WorkspaceDocument, '_removed'>,
  ) {}
  requestRender(
    action: RenderAction = 'redraw',
    navDelta?: AffineDelta,
    settle = false,
    dirtyBounds?: readonly [number, number, number, number],
  ): void {
    if (!this.document._removed)
      this.events.fire('renderrequest', {
        action,
        navDelta,
        settle,
        ...(dirtyBounds ? { dirtyBounds } : {}),
      });
  }
  requestOverlay(): void {
    if (!this.document._removed) this.events.fire('overlayrequest');
  }
}
