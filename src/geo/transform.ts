import { Bounds } from './bounds';

export class Transform {
  constructor(
    public mx: number = 1,
    public my: number = 1,
    public bx: number = 0,
    public by: number = 0
  ) { }

  static getTransform(b1: Bounds, b2: Bounds, flipY: boolean = false): Transform {
    const mx = b2.width / b1.width || 1;
    const my = (flipY ? -b2.height / b1.height : b2.height / b1.height) || 1;
    const bx = b2.xmin - mx * b1.xmin;
    const by = flipY ? b2.ymax - my * b1.ymin : b2.ymin - my * b1.ymin;
    return new Transform(mx, my, bx, by);
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
    // Zooming relative to a pivot point (px, py) in projected space
    this.bx = px * (1 - k) + this.bx * k;
    this.by = py * (1 - k) + this.by * k;
    this.mx *= k;
    this.my *= k;
  }

  clone(): Transform {
    return new Transform(this.mx, this.my, this.bx, this.by);
  }
}
