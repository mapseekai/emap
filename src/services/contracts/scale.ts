import type {
  ScaleCalculator,
  GetScaleMetricsOptions,
  ScaleViewMetrics,
} from '../../geo/scale-calculator';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ScaleContract {
  /** @internal */
  _scaleCalculator?: ScaleCalculator;
  getScaleMetrics(options?: GetScaleMetricsOptions): Promise<ScaleViewMetrics | null>;
  /** @internal */
  _scaleCalculatorInstance(): ScaleCalculator;
}
