import { isWebMercatorCrs } from '../../../domain/geo/crs-resolver';
import {
  ScaleCalculator,
  type GetScaleMetricsOptions,
  type ScaleView,
  type ScaleViewMetrics,
} from '../../../domain/geo/scale-calculator';
import { Viewport } from '../../../domain/geo/viewport';
import type { ViewContract as ViewServiceImpl } from '../../../runtime/services/contracts/view';

interface ScaleViewSample {
  px: number;
  py: number;
  coordinate: [number, number];
}

interface ScaleViewSnapshot {
  view: ScaleView;
  samples: ScaleViewSample[];
}

function captureScaleView(viewport: Viewport, crs: string): ScaleViewSnapshot | null {
  const width = viewport.width;
  const height = viewport.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const x = width / 2;
  const samples: ScaleViewSample[] = [];
  try {
    for (const py of [0, height / 2, height]) {
      for (const px of [x, x + 1]) {
        samples.push({ px, py, coordinate: viewport.unproject(px, py) });
      }
    }
  } catch {
    return null;
  }

  return {
    samples,
    view: {
      crs,
      width,
      height,
      unproject(px, py): [number, number] {
        const sample = samples.find((candidate) => candidate.px === px && candidate.py === py);
        if (!sample) throw new Error('Scale view requested a coordinate outside its snapshot');
        return [...sample.coordinate];
      },
    },
  };
}

function isScaleViewCurrent(viewport: Viewport, crs: string, snapshot: ScaleViewSnapshot): boolean {
  if (
    crs !== snapshot.view.crs ||
    viewport.width !== snapshot.view.width ||
    viewport.height !== snapshot.view.height
  ) {
    return false;
  }

  try {
    return snapshot.samples.every((sample) => {
      const current = viewport.unproject(sample.px, sample.py);
      return current[0] === sample.coordinate[0] && current[1] === sample.coordinate[1];
    });
  } catch {
    return false;
  }
}

interface Dependencies {
  view: Pick<ViewServiceImpl, '_viewport' | 'getCRS' | 'getZoom'>;
}

/** scale implementation, wired through explicit service dependencies. */
export class ScaleServiceImpl {
  _scaleCalculator?: ScaleCalculator;

  public async getScaleMetrics(
    options: GetScaleMetricsOptions = {},
  ): Promise<ScaleViewMetrics | null> {
    const crs = this.deps.view.getCRS();
    const snapshot = captureScaleView(this.deps.view._viewport, crs);
    if (!snapshot) return null;
    const zoom = isWebMercatorCrs(crs) ? this.deps.view.getZoom() : undefined;
    const metrics = await this._scaleCalculatorInstance().getMetrics(snapshot.view, options);
    if (
      !metrics ||
      !isScaleViewCurrent(this.deps.view._viewport, this.deps.view.getCRS(), snapshot)
    )
      return null;
    return zoom === undefined ? metrics : { ...metrics, zoom };
  }

  _scaleCalculatorInstance(): ScaleCalculator {
    return this._scaleCalculator ?? (this._scaleCalculator = new ScaleCalculator());
  }

  constructor(private readonly deps: Dependencies) {}
}
