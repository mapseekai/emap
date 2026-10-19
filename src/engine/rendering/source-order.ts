import type { LayerSpecification } from '../map/layer';
import type { RenderPass } from '../../runtime/services/contracts/render-pass';

export type RenderPassStage = 'before-layers' | 'after-layers' | { readonly sourceId: string };

export type SourceRenderBlock = { layers: readonly LayerSpecification[] } | { pass: RenderPass };

export function checkedSourceOrder(order: readonly string[]): string[] {
  if (
    !Array.isArray(order as unknown) ||
    order.some((id) => typeof id !== 'string' || !id || id.length > 256) ||
    new Set(order).size !== order.length
  ) {
    throw new Error('Source order must contain unique, nonempty source IDs');
  }
  return [...order];
}

/** Expands top-first source order into bottom-first render blocks. */
export function sourceRenderBlocks(
  layers: readonly LayerSpecification[],
  passes: ReadonlyMap<RenderPass, RenderPassStage>,
  topFirst: readonly string[],
): SourceRenderBlock[] {
  const configured = new Set(topFirst);
  const blocks: SourceRenderBlock[] = [];
  const vectors = new Map<string, LayerSpecification[]>();
  const sources = new Map<string, RenderPass[]>();

  for (const layer of layers) {
    const group = vectors.get(layer.source) ?? [];
    group.push(layer);
    vectors.set(layer.source, group);
  }
  for (const [pass, stage] of passes) {
    if (!stage || typeof stage !== 'object') continue;
    const group = sources.get(stage.sourceId) ?? [];
    group.push(pass);
    sources.set(stage.sourceId, group);
    // Unconfigured source passes preserve the legacy below-vector behavior.
    if (!configured.has(stage.sourceId)) blocks.push({ pass });
  }

  const unconfigured = layers.filter((layer) => !configured.has(layer.source));
  if (unconfigured.length) blocks.push({ layers: unconfigured });
  for (const id of [...topFirst].reverse()) {
    const group = vectors.get(id);
    if (group?.length) blocks.push({ layers: group });
    for (const pass of sources.get(id) ?? []) blocks.push({ pass });
  }
  // Keep point-LOD cache maintenance alive for raster-only frames.
  if (!layers.length) blocks.unshift({ layers: [] });
  return blocks;
}
