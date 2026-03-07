import { Bounds } from './bounds';

/**
 * Pure affine 2D transformation: scale + translate.
 * Represents the matrix [mx 0 bx; 0 my by; 0 0 1].
 */
export class AffineTransform {
  constructor(
    public mx: number = 1,
    public my: number = 1,
    public bx: number = 0,
    public by: number = 0
  ) { }

  static fromBounds(src: Bounds, dst: Bounds, flipY = false): AffineTransform {
    const mx = dst.width / src.width || 1;
    const my = (flipY ? -dst.height / src.height : dst.height / src.height) || 1;
    const bx = dst.xmin - mx * src.xmin;
    const by = flipY ? dst.ymax - my * src.ymin : dst.ymin - my * src.ymin;
    return new AffineTransform(mx, my, bx, by);
  }

  project(x: number, y: number): [number, number] {
    return [x * this.mx + this.bx, y * this.my + this.by];
  }

  unproject(px: number, py: number): [number, number] {
    return [(px - this.bx) / this.mx, (py - this.by) / this.my];
  }

  translate(dx: number, dy: number): void {
    this.bx += dx;
    this.by += dy;
  }

  scale(k: number, px: number, py: number): void {
    this.bx = px * (1 - k) + this.bx * k;
    this.by = py * (1 - k) + this.by * k;
    this.mx *= k;
    this.my *= k;
  }

  clone(): AffineTransform {
    return new AffineTransform(this.mx, this.my, this.bx, this.by);
  }
}

// Re-export for backward compatibility
export { AffineTransform as Transform };
