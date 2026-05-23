// Backward-compatible re-export. The class was renamed to `OverlayRenderer`
// in the PR3 (fast-nav architecture) work — it serves more than just edit
// overlays now (hover/selection highlights also route through it).
// Prefer `OverlayRenderer` in new code.
export { OverlayRenderer as EditOverlayRenderer } from './overlay-renderer';
