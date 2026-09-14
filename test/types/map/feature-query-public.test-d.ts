// Public FeatureQuery visibility-boundary contract. Checked by `tsc --noEmit`;
// Vitest does not execute *.test-d.ts files.
import type { FeatureQuery, HighlightManager, VisibleLayerLookup } from '../../../src/index';

declare const query: FeatureQuery;
declare const visibleLayers: VisibleLayerLookup;

query.query(undefined, undefined, visibleLayers);

const highlightVisibleLayers: Parameters<HighlightManager['renderHighlights']>[4] = visibleLayers;
void highlightVisibleLayers;

const sourceLayers = visibleLayers.get('source');
const isVisible: boolean | undefined = sourceLayers?.has('layer');
void isVisible;

// @ts-expect-error the public lookup does not expose Map mutation
visibleLayers.set('source', new Set(['layer']));

if (sourceLayers) {
  // @ts-expect-error the public layer set does not expose Set mutation
  sourceLayers.add('layer');
}
