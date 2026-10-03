declare module 'libtess' {
  export const gluEnum: Record<string, number>;
  export const windingRule: Record<string, number>;
  export const primitiveType: Record<string, number>;
  export class GluTesselator {
    gluTessProperty(property: number, value: number): void;
    gluTessNormal(x: number, y: number, z: number): void;
    gluTessCallback(
      which: number,
      callback: ((value: number) => void) | ((coords: number[]) => number) | (() => void),
    ): void;
    gluTessBeginPolygon(data?: unknown): void;
    gluTessBeginContour(): void;
    gluTessVertex(coords: number[], data: number): void;
    gluTessEndContour(): void;
    gluTessEndPolygon(): void;
    gluDeleteTess(): void;
  }
}
