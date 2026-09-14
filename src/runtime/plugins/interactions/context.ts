import type { AutoCompletePolygonHandler } from '../../../engine/core/handlers/auto-complete-polygon';
import type { BoxSelectHandler } from '../../../engine/core/handlers/box-select';
import type { ClickSelectHandler } from '../../../engine/core/handlers/click-select';
import type { DragPanHandler } from '../../../engine/core/handlers/drag-pan';
import type { DrawFeatureHandler } from '../../../engine/core/handlers/draw-feature';
import type { LassoSelectHandler } from '../../../engine/core/handlers/lasso-select';
import type { MeasureHandler } from '../../../engine/core/handlers/measure';
import type { PartEditHandler } from '../../../engine/core/handlers/part-edit';
import type { ReshapeFeatureHandler } from '../../../engine/core/handlers/reshape-feature';
import type { RingEditHandler } from '../../../engine/core/handlers/ring-edit';
import type { ScrollZoomHandler } from '../../../engine/core/handlers/scroll-zoom';
import type { SplitFeatureHandler } from '../../../engine/core/handlers/split-feature';
import type { TransformFeatureHandler } from '../../../engine/core/handlers/transform-feature';
import type { VertexEditHandler } from '../../../engine/core/handlers/vertex-edit';

/** Native Cordis service contracts; no emap-specific service container. */
declare module 'cordis' {
  interface Context {
    dragPan: Pick<DragPanHandler, keyof DragPanHandler>;
    scrollZoom: Pick<ScrollZoomHandler, keyof ScrollZoomHandler>;
    clickSelect: Pick<ClickSelectHandler, keyof ClickSelectHandler>;
    boxSelect: Pick<BoxSelectHandler, keyof BoxSelectHandler>;
    lassoSelect: Pick<LassoSelectHandler, keyof LassoSelectHandler>;
    vertexEdit: Pick<VertexEditHandler, keyof VertexEditHandler>;
    drawFeature: Pick<DrawFeatureHandler, keyof DrawFeatureHandler>;
    splitFeature: Pick<SplitFeatureHandler, keyof SplitFeatureHandler>;
    reshapeFeature: Pick<ReshapeFeatureHandler, keyof ReshapeFeatureHandler>;
    autoCompletePolygon: Pick<AutoCompletePolygonHandler, keyof AutoCompletePolygonHandler>;
    ringEdit: Pick<RingEditHandler, keyof RingEditHandler>;
    partEdit: Pick<PartEditHandler, keyof PartEditHandler>;
    measure: Pick<MeasureHandler, keyof MeasureHandler>;
    transformFeature: Pick<TransformFeatureHandler, keyof TransformFeatureHandler>;
  }
}
