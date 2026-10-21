import type { Emap } from '@mapseekai/emap';

export interface SymbolControlTarget
  extends Pick<Emap, 'getLayers' | 'setLayerSymbol' | 'setLayerVisibility'> {
  getLabelFields(id: string): string[];
  readonly labelControlRevision: string;
  readonly labelStats?: {
    error?: string | null;
    pending?: boolean;
    placed?: number;
    collisionSkipped?: number;
    capacitySkipped?: number;
    atlasBytes?: number;
    glyphCount?: number;
    missingGlyphs?: number;
    bitmapFallbackLabels?: number;
  };
  readonly iconStats?: {
    errors: readonly string[];
    pending: number;
    images: number;
    imageBytes: number;
    instances: number;
  };
}
