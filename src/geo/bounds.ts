export class Bounds {
  constructor(
    public xmin: number = Infinity,
    public ymin: number = Infinity,
    public xmax: number = -Infinity,
    public ymax: number = -Infinity,
  ) {}

  static fromArray(arr: [number, number, number, number]): Bounds {
    return new Bounds(arr[0], arr[1], arr[2], arr[3]);
  }

  get width(): number {
    return this.xmax - this.xmin;
  }

  get height(): number {
    return this.ymax - this.ymin;
  }

  get centerX(): number {
    return (this.xmin + this.xmax) * 0.5;
  }

  get centerY(): number {
    return (this.ymin + this.ymax) * 0.5;
  }

  hasBounds(): boolean {
    return this.xmin <= this.xmax && this.ymin <= this.ymax;
  }

  clone(): Bounds {
    return new Bounds(this.xmin, this.ymin, this.xmax, this.ymax);
  }

  mergePoint(x: number, y: number): void {
    if (x < this.xmin) this.xmin = x;
    if (x > this.xmax) this.xmax = x;
    if (y < this.ymin) this.ymin = y;
    if (y > this.ymax) this.ymax = y;
  }

  merge(other: Bounds): void {
    if (!other.hasBounds()) return;
    if (other.xmin < this.xmin) this.xmin = other.xmin;
    if (other.xmax > this.xmax) this.xmax = other.xmax;
    if (other.ymin < this.ymin) this.ymin = other.ymin;
    if (other.ymax > this.ymax) this.ymax = other.ymax;
  }

  fillOut(aspect: number, focusX: number = 0.5, focusY: number = 0.5): this {
    const w = this.width;
    const h = this.height;
    const currAspect = w / h;
    let pad;
    if (currAspect < aspect) {
      pad = h * aspect - w;
      this.xmin -= (1 - focusX) * pad;
      this.xmax += focusX * pad;
    } else {
      pad = w / aspect - h;
      this.ymin -= (1 - focusY) * pad;
      this.ymax += focusY * pad;
    }
    return this;
  }

  scale(k: number): void {
    const cx = this.centerX;
    const cy = this.centerY;
    const w = this.width * k;
    const h = this.height * k;
    this.xmin = cx - w / 2;
    this.xmax = cx + w / 2;
    this.ymin = cy - h / 2;
    this.ymax = cy + h / 2;
  }
}
