import type { AppendedArc } from '../../adapter/mapshaper-adapter';
import type {
  MapshaperDataset,
  MapshaperLayer,
  PathLayer,
  PathShape,
} from '../../types/mapshaper-types';
import type { PathShapePatch } from '../../edit/commands/path-geometry-patch';
import { snapshotLiveArc, type MiniDataset } from './_mini-dataset';

export interface MiniTranslation {
  /** Arcs to append onto the live collection, in live id order. */
  appendedArcs: AppendedArc[];
  /** Patches for candidates (translated mini shapes) and spliced neighbors. */
  shapePatches: PathShapePatch[];
  /** Post-operation mini arc id to final live arc id; unmapped runtime arcs are holes. */
  miniToLiveFinal: readonly (number | undefined)[];
}

function unsigned(id: number): number {
  return id < 0 ? -id - 1 : id;
}

/** Bitwise-complement a mapshaper arc reference (flip traversal direction). */
function flipRef(ref: number): number {
  return -ref - 1;
}

/** Forward coordinate equality (xy + zz-nullness + zz) between two arc snapshots. */
function arcsEqualForward(a: AppendedArc, b: AppendedArc): boolean {
  const n = a.xx.length;
  if (n !== b.xx.length) return false;
  for (let i = 0; i < n; i++) {
    if (a.xx[i] !== b.xx[i] || a.yy[i] !== b.yy[i]) return false;
  }
  const az = a.zz ?? null;
  const bz = b.zz ?? null;
  if ((az === null) !== (bz === null)) return false;
  if (az && bz) {
    if (az.length !== bz.length) return false;
    for (let i = 0; i < az.length; i++) {
      if (az[i] !== bz[i]) return false;
    }
  }
  return true;
}

function sameShape(a: PathShape, b: PathShape): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const pa = a[i]!;
    const pb = b[i]!;
    if (pa.length !== pb.length) return false;
    for (let j = 0; j < pa.length; j++) {
      if (pa[j] !== pb[j]) return false;
    }
  }
  return true;
}

export function translateMiniDataset(opts: {
  mini: MiniDataset;
  liveDataset: MapshaperDataset;
  liveArcCount: number;
  liveLayers: readonly MapshaperLayer[];
  extraShapes?: readonly PathShape[];
}): MiniTranslation | null {
  const { mini, liveDataset, liveArcCount, liveLayers, extraShapes } = opts;
  const liveArcs = liveDataset.arcs;
  if (!liveArcs) return null;
  const sentinelLayer = mini.dataset.layers[mini.sentinelLayerIndex] as PathLayer;
  const sentinelShapes = sentinelLayer?.shapes;
  if (!sentinelShapes) return null;
  const miniArcCount = mini.arcs.size();
  const isValidMiniRef = (ref: number): boolean =>
    Number.isInteger(ref) && unsigned(ref) < miniArcCount;

  const lineages: (readonly number[])[] = [];
  const ownerCount = new Map<number, number>();
  for (let k = 0; k < mini.miniToLiveArc.length; k++) {
    const sentinel = sentinelShapes[k] as PathShape | null;
    if (!sentinel || sentinel.length !== 1 || sentinel[0]!.length === 0) return null;
    const lineage = sentinel[0]!;
    lineages.push(lineage);
    for (const ref of lineage) {
      if (!isValidMiniRef(ref)) return null;
      const postId = unsigned(ref);
      ownerCount.set(postId, (ownerCount.get(postId) ?? 0) + 1);
    }
  }

  const miniToLiveFinal: (number | undefined)[] = new Array(miniArcCount);
  const appendedArcs: AppendedArc[] = [];
  const assignAppend = (postId: number): void => {
    miniToLiveFinal[postId] = liveArcCount + appendedArcs.length;
    appendedArcs.push(snapshotLiveArc(mini.arcs, postId));
  };
  for (let k = 0; k < lineages.length; k++) {
    const lineage = lineages[k]!;
    for (const ref of lineage) {
      const postId = unsigned(ref);
      if (miniToLiveFinal[postId] !== undefined) continue;
      if (ownerCount.get(postId) === 1 && lineage.length === 1 && ref >= 0) {
        const liveId = mini.miniToLiveArc[k]!;
        if (
          arcsEqualForward(
            snapshotLiveArc(mini.arcs, postId),
            snapshotLiveArc(liveArcs, liveId),
          )
        ) {
          miniToLiveFinal[postId] = liveId;
          continue;
        }
      }
      assignAppend(postId);
    }
  }

  const referenced = new Set<number>();
  const collectRefs = (shape: PathShape): boolean => {
    for (const part of shape) {
      for (const ref of part) {
        if (!isValidMiniRef(ref)) return false;
        referenced.add(unsigned(ref));
      }
    }
    return true;
  };
  for (const [layerIndex, ids] of mini.candidates) {
    const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
    for (const featureId of ids) {
      const shape = miniLayer.shapes?.[featureId] as PathShape | null;
      if (shape && !collectRefs(shape)) return null;
    }
  }
  for (const shape of extraShapes ?? []) {
    if (!collectRefs(shape)) return null;
  }
  const pending = [...referenced]
    .filter((postId) => miniToLiveFinal[postId] === undefined)
    .sort((a, b) => a - b);
  for (const postId of pending) assignAppend(postId);

  const translation: MiniTranslation = { appendedArcs, shapePatches: [], miniToLiveFinal };
  const shapePatches: PathShapePatch[] = [];
  for (const [layerIndex, featureIds] of mini.candidates) {
    const liveLayer = liveLayers[layerIndex] as PathLayer;
    const miniLayer = mini.dataset.layers[layerIndex] as PathLayer;
    for (const featureId of featureIds) {
      const before = liveLayer.shapes?.[featureId] as PathShape | null;
      const miniShape = miniLayer.shapes?.[featureId] as PathShape | null;
      if (!before || !miniShape) continue;
      let after: PathShape;
      try {
        after = translateShapeFromMini(translation, miniShape);
      } catch {
        return null;
      }
      if (!sameShape(before, after)) {
        shapePatches.push({
          layer: liveLayer,
          featureId,
          before: before.map((part) => part.slice()),
          after,
        });
      }
    }
  }

  const translatedLineages = lineages.map((lineage) =>
    lineage.map((ref) => {
      const mapped = miniToLiveFinal[unsigned(ref)];
      if (mapped === undefined) throw new Error(`unmappable lineage ref ${ref}`);
      return ref < 0 ? flipRef(mapped) : mapped;
    }),
  );
  const spliceByFeature = new Map<
    string,
    { layerIndex: number; featureId: number; after: PathShape }
  >();
  for (let k = 0; k < mini.miniToLiveArc.length; k++) {
    const liveId = mini.miniToLiveArc[k]!;
    const seq = translatedLineages[k]!;
    if (seq.length === 1 && seq[0] === liveId) continue;
    for (const at of mini.referencers.get(liveId) ?? []) {
      if (mini.candidates.get(at.layerIndex)?.has(at.featureId)) continue;
      const key = `${at.layerIndex}:${at.featureId}`;
      let entry = spliceByFeature.get(key);
      if (!entry) {
        const liveLayer = liveLayers[at.layerIndex] as PathLayer;
        const before = liveLayer.shapes?.[at.featureId] as PathShape | null;
        if (!before) continue;
        entry = {
          layerIndex: at.layerIndex,
          featureId: at.featureId,
          after: before.map((part) => part.slice()),
        };
        spliceByFeature.set(key, entry);
      }
      entry.after = entry.after.map((part) => {
        const out: number[] = [];
        for (const ref of part) {
          if (unsigned(ref) !== liveId) {
            out.push(ref);
          } else if (ref >= 0) {
            out.push(...seq);
          } else {
            for (let i = seq.length - 1; i >= 0; i--) out.push(flipRef(seq[i]!));
          }
        }
        return out;
      });
    }
  }
  for (const { layerIndex, featureId, after } of spliceByFeature.values()) {
    const liveLayer = liveLayers[layerIndex] as PathLayer;
    const before = liveLayer.shapes![featureId] as PathShape;
    if (!sameShape(before, after)) {
      shapePatches.push({
        layer: liveLayer,
        featureId,
        before: before.map((part) => part.slice()),
        after,
      });
    }
  }

  translation.shapePatches = shapePatches;
  return translation;
}

/** Translate one mini-space shape to live arc ids. Throws on unmappable refs. */
export function translateShapeFromMini(
  translation: MiniTranslation,
  shape: PathShape,
): PathShape {
  return shape.map((part) =>
    part.map((ref) => {
      const mapped = translation.miniToLiveFinal[unsigned(ref)];
      if (mapped === undefined) throw new Error(`unmappable mini arc ref ${ref}`);
      return ref < 0 ? flipRef(mapped) : mapped;
    }),
  );
}
