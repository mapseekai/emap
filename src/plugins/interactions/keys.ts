import type { AutoCompletePolygonHandler } from '../../core/handlers/auto-complete-polygon';
import type { BoxSelectHandler } from '../../core/handlers/box-select';
import type { ClickSelectHandler } from '../../core/handlers/click-select';
import type { DragPanHandler } from '../../core/handlers/drag-pan';
import type { DrawFeatureHandler } from '../../core/handlers/draw-feature';
import type { LassoSelectHandler } from '../../core/handlers/lasso-select';
import type { MeasureHandler } from '../../core/handlers/measure';
import type { PartEditHandler } from '../../core/handlers/part-edit';
import type { ReshapeFeatureHandler } from '../../core/handlers/reshape-feature';
import type { RingEditHandler } from '../../core/handlers/ring-edit';
import type { ScrollZoomHandler } from '../../core/handlers/scroll-zoom';
import type { SplitFeatureHandler } from '../../core/handlers/split-feature';
import type { TransformFeatureHandler } from '../../core/handlers/transform-feature';
import type { VertexEditHandler } from '../../core/handlers/vertex-edit';
import { serviceKey } from '../../kernel/service';

export const dragPanService =
  serviceKey<Pick<DragPanHandler, keyof DragPanHandler>>('interaction.dragPan');
export const scrollZoomService =
  serviceKey<Pick<ScrollZoomHandler, keyof ScrollZoomHandler>>('interaction.scrollZoom');
export const clickSelectService =
  serviceKey<Pick<ClickSelectHandler, keyof ClickSelectHandler>>('interaction.clickSelect');
export const boxSelectService =
  serviceKey<Pick<BoxSelectHandler, keyof BoxSelectHandler>>('interaction.boxSelect');
export const lassoSelectService =
  serviceKey<Pick<LassoSelectHandler, keyof LassoSelectHandler>>('interaction.lassoSelect');
export const vertexEditService =
  serviceKey<Pick<VertexEditHandler, keyof VertexEditHandler>>('interaction.vertexEdit');
export const drawFeatureService =
  serviceKey<Pick<DrawFeatureHandler, keyof DrawFeatureHandler>>('interaction.drawFeature');
export const splitFeatureService = serviceKey<Pick<SplitFeatureHandler, keyof SplitFeatureHandler>>(
  'interaction.splitFeature',
);
export const reshapeFeatureService = serviceKey<
  Pick<ReshapeFeatureHandler, keyof ReshapeFeatureHandler>
>('interaction.reshapeFeature');
export const autoCompletePolygonService = serviceKey<
  Pick<AutoCompletePolygonHandler, keyof AutoCompletePolygonHandler>
>('interaction.autoCompletePolygon');
export const ringEditService =
  serviceKey<Pick<RingEditHandler, keyof RingEditHandler>>('interaction.ringEdit');
export const partEditService =
  serviceKey<Pick<PartEditHandler, keyof PartEditHandler>>('interaction.partEdit');
export const measureService =
  serviceKey<Pick<MeasureHandler, keyof MeasureHandler>>('interaction.measure');
export const transformFeatureService = serviceKey<
  Pick<TransformFeatureHandler, keyof TransformFeatureHandler>
>('interaction.transformFeature');
