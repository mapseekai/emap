import { describe, it, expect } from 'vitest';
import * as emap from './index';
import { DragPanHandler as NewDragPan } from './core/handlers/drag-pan';

describe('public export surface (DX P1 additions)', () => {
  it('exports HandlerManager and the new handler classes', () => {
    expect(typeof emap.HandlerManager).toBe('function');
    expect(typeof emap.DragPanHandler).toBe('function');
    expect(typeof emap.ScrollZoomHandler).toBe('function');
    expect(typeof emap.isHandler).toBe('function');
  });

  it('public DragPanHandler is the new handler, not the old primitive', () => {
    // Guards the breaking 0.3.0 consolidation against regression.
    expect(emap.DragPanHandler).toBe(NewDragPan);
  });

  it('exports the format-plugin registry hook (arrow-free core surface)', () => {
    expect(typeof emap.registerFormat).toBe('function');
  });

  it('keeps BasemapControl as a runtime export', () => {
    expect(typeof emap.BasemapControl).toBe('function');
  });

  it('keeps LayerControl as a runtime export', () => {
    expect(typeof (emap as Record<string, unknown>).LayerControl).toBe('function');
  });
});
