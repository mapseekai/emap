/**
 * Image symbols are a property of a circle/point layer, never a separate layer.
 * @example
 * const icon: IconOptions = { url: '/images/pin.png', size: 32, anchor: [0.5, 1] };
 */
export interface IconOptions {
  url: string;
  enabled?: boolean;
  /** Height in CSS pixels, retaining aspect ratio, or explicit [width, height]. Default 32. */
  size?: number | readonly [number, number];
  /** Normalized anchor in the cropped image. [0.5, 1] places a pin tip on the point. */
  anchor?: readonly [number, number];
  /** Clockwise rotation around the anchor, in screen-space degrees. */
  rotation?: number;
  /** Screen-space CSS pixel offset, applied after rotation. */
  offset?: readonly [number, number];
  opacity?: number;
  /** Optional alpha-mask recoloring. Omit to preserve the original image colors. */
  tint?: string;
  /** Pixel crop [x, y, width, height] in a shared sprite image. */
  rect?: readonly [number, number, number, number];
}
const keys = new Set([
  'url',
  'enabled',
  'size',
  'anchor',
  'rotation',
  'offset',
  'opacity',
  'tint',
  'rect',
]);
function tuple(value: unknown, count: number, low: number, high: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === count &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high)
  );
}
export function validateIconOptions(icon: IconOptions): void {
  if (!icon || typeof icon !== 'object' || Array.isArray(icon))
    throw new Error('icon must be an options object.');
  for (const key of Object.keys(icon))
    if (!keys.has(key)) throw new Error(`Unknown icon option: ${key}`);
  if (typeof icon.url !== 'string' || !icon.url.trim() || icon.url.length > 2 * 1024 * 1024)
    throw new Error('icon.url must be a nonempty image URL.');
  const url = icon.url.trim();
  if (
    /^[a-z][a-z\d+.-]*:/i.test(url) &&
    !/^https?:|^blob:|^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/i.test(url)
  )
    throw new Error('Unsupported icon URL scheme.');
  const resolved = new URL(url, 'https://emap.invalid/');
  if (
    !['http:', 'https:', 'blob:', 'data:'].includes(resolved.protocol) ||
    resolved.username ||
    resolved.password
  )
    throw new Error('Unsupported icon URL or embedded credentials.');
  if (icon.enabled !== undefined && typeof icon.enabled !== 'boolean')
    throw new Error('Invalid icon.enabled.');
  if (
    icon.size !== undefined &&
    !(typeof icon.size === 'number'
      ? Number.isFinite(icon.size) && icon.size >= 1 && icon.size <= 512
      : tuple(icon.size, 2, 1, 512))
  )
    throw new Error('icon.size must be 1..512 CSS pixels.');
  if (icon.anchor !== undefined && !tuple(icon.anchor, 2, 0, 1))
    throw new Error('icon.anchor requires normalized [x,y] in [0,1].');
  if (icon.offset !== undefined && !tuple(icon.offset, 2, -512, 512))
    throw new Error('icon.offset requires two finite CSS pixel offsets within ±512.');
  if (
    icon.rotation !== undefined &&
    (typeof icon.rotation !== 'number' || !Number.isFinite(icon.rotation))
  )
    throw new Error('Invalid icon.rotation.');
  if (
    icon.opacity !== undefined &&
    (typeof icon.opacity !== 'number' ||
      !Number.isFinite(icon.opacity) ||
      icon.opacity < 0 ||
      icon.opacity > 1)
  )
    throw new Error('icon.opacity must be 0..1.');
  if (
    icon.tint !== undefined &&
    (typeof icon.tint !== 'string' || !icon.tint.trim() || icon.tint.length > 256)
  )
    throw new Error('Invalid icon.tint.');
  if (
    icon.rect !== undefined &&
    (!tuple(icon.rect, 4, 0, 4096) ||
      !icon.rect.every(Number.isInteger) ||
      !icon.rect[2] ||
      !icon.rect[3])
  )
    throw new Error('icon.rect requires integer [x,y,width,height].');
}
export function cloneIconOptions(icon: IconOptions): IconOptions {
  validateIconOptions(icon);
  return {
    ...icon,
    url: icon.url.trim(),
    ...(Array.isArray(icon.size) ? { size: [...icon.size] as [number, number] } : {}),
    ...(icon.anchor ? { anchor: [...icon.anchor] as [number, number] } : {}),
    ...(icon.offset ? { offset: [...icon.offset] as [number, number] } : {}),
    ...(icon.rect ? { rect: [...icon.rect] as [number, number, number, number] } : {}),
  };
}
/** Local symbol geometry only; source-to-screen coordinates still use AffineTransform. */
export function iconMetrics(icon: IconOptions, width: number, height: number) {
  const rect = icon.rect ?? ([0, 0, width, height] as const);
  if (rect[0] + rect[2] > width || rect[1] + rect[3] > height)
    throw new Error('Icon sprite rectangle exceeds the image bounds.');
  const requested = icon.size ?? 32;
  const size: readonly [number, number] =
    typeof requested === 'number' ? [(requested * rect[2]) / rect[3], requested] : requested;
  if (!size.every((n) => Number.isFinite(n) && n > 0 && n <= 512))
    throw new Error(
      'Resolved icon size exceeds 512 CSS pixels; provide an explicit [width,height].',
    );
  const anchor = icon.anchor ?? ([0.5, 0.5] as const),
    offset = icon.offset ?? ([0, 0] as const);
  const angle = (((icon.rotation ?? 0) % 360) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle);
  const corners = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].map(([u, v]) => {
    const x = (u - anchor[0]) * size[0],
      y = (v - anchor[1]) * size[1];
    return [c * x - s * y + offset[0], s * x + c * y + offset[1]];
  });
  const bounds: [number, number, number, number] = [
    Math.min(...corners.map((p) => p[0])),
    Math.min(...corners.map((p) => p[1])),
    Math.max(...corners.map((p) => p[0])),
    Math.max(...corners.map((p) => p[1])),
  ];
  return {
    rect,
    size,
    anchor,
    offset,
    angle,
    bounds,
    radius: Math.max(...bounds.map(Math.abs)) + 1,
  };
}
