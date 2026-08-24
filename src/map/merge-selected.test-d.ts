import type { Emap, FeatureRef, MergeSelectedOptions } from '../index';

declare const map: Emap;
declare const ref: FeatureRef;

const options = { attributeSource: ref } satisfies MergeSelectedOptions;
map.ops.mergeSelected();
map.ops.mergeSelected(options);

// @ts-expect-error attributeSource must be a complete FeatureRef.
map.ops.mergeSelected({ attributeSource: { id: 1 } });
