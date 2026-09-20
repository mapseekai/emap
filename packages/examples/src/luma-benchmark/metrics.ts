import { AffineTransform } from '../../../../src/domain/geo/transform';
export interface Samples { cpuMs: number[]; frameMs: number[] }
export function summarize(samples: Samples) {
  const cpu = [...samples.cpuMs].sort((a, b) => a - b);
  const frame = [...samples.frameMs].sort((a, b) => a - b);
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const percentile = (values: number[]) => values.length ? values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] : null;
  const average = mean(frame);
  return { samples: cpu.length, cpuMeanMs: mean(cpu), cpuP95Ms: percentile(cpu),
    frameMeanMs: average, frameP95Ms: percentile(frame), fps: average ? 1000 / average : null,
    framesOver33ms: frame.filter((v) => v > 1000 / 30).length };
}
/** Identical frame-indexed trajectory for both backends, independent of measured speed. */
export function navigationFrame(base: AffineTransform, index: number, count: number, width: number, height: number): AffineTransform {
  const phase = count > 1 ? index / (count - 1) * Math.PI * 2 : 0;
  const t = base.clone();
  t.scale(1 + 0.65 * (1 - Math.cos(phase)), width / 2, height / 2);
  t.translate(Math.sin(phase) * width * 0.14, Math.sin(phase * 2) * height * 0.10);
  return t;
}
export function animationTick(signal: AbortSignal): Promise<number> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { cancelAnimationFrame(id); reject(signal.reason); };
    const id = requestAnimationFrame((time) => { signal.removeEventListener('abort', abort); resolve(time); });
    signal.addEventListener('abort', abort, { once: true });
  });
}
