import { AffineTransform } from '../../../domain/geo/transform';
import type { Rect } from '../../../integrations/luma/types';
/** A source-anchored, conservative detail frame for half-device-pixel paths.
 * Panning changes only the final projection, not these vertex buffers. A level
 * is never coarser than the requested physical resolution; eight levels per
 * octave keep overdraw/storage overhead bounded. This changes snapping phase,
 * not the original source coordinates or the half-pixel approximation bound.
 */
export function screenPathFrame(
  view: AffineTransform,
  bounds: Rect,
  pixelRatio: number,
): [number, number, number, number] {
  const level = (value: number) => {
    const magnitude = Math.abs(value),
      physical = magnitude * pixelRatio;
    const rounded = 2 ** (Math.ceil(Math.log2(physical) * 8) / 8) / pixelRatio;
    return (
      Math.sign(value) *
      (Number.isFinite(rounded) && rounded > 0 ? Math.max(magnitude, rounded) : magnitude)
    );
  };
  const mx = level(view.mx),
    my = level(view.my),
    x = bounds[0] / 2 + bounds[2] / 2,
    y = bounds[1] / 2 + bounds[3] / 2;
  return [mx, my, -x * mx, -y * my];
}
