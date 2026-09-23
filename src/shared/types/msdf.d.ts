declare module 'harfbuzzjs/hb.js' {
  const create: (options: { wasmBinary: ArrayBuffer }) => Promise<{ HEAPU8: Uint8Array }>;
  export default create;
}
declare module 'harfbuzzjs/hbjs.js' {
  interface Blob {
    destroy(): void;
  }
  interface Face {
    upem: number;
    collectUnicodes(): Uint32Array;
    destroy(): void;
  }
  interface Font {
    setScale(x: number, y: number): void;
    glyphExtents(
      id: number,
    ): { xBearing: number; yBearing: number; width: number; height: number } | null;
    glyphToPath(id: number): string;
    destroy(): void;
  }
  interface Buffer {
    addText(text: string): void;
    guessSegmentProperties(): void;
    setDirection(direction: string): void;
    setScript(script: string): void;
    json(): { g: number; cl: number; ax: number; ay: number; dx: number; dy: number }[];
    destroy(): void;
  }
  interface HarfBuzz {
    createBlob(bytes: ArrayBuffer): Blob;
    createFace(blob: Blob, index: number): Face;
    createFont(face: Face): Font;
    createBuffer(): Buffer;
    shape(font: Font, buffer: Buffer, features?: string): void;
  }
  const create: (module: unknown) => HarfBuzz;
  export default create;
}
declare module 'bidi-js' {
  interface Embedding {
    levels: Uint8Array;
    paragraphs: { start: number; end: number; level: number }[];
  }
  const create: () => {
    getEmbeddingLevels(text: string): Embedding;
    getReorderSegments(text: string, embedding: Embedding): [number, number][];
  };
  export default create;
}
