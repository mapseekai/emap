import type { Bounds } from '../../../domain/geo/bounds';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ProjectionContract {
  setCRS(crs: string): void;
  reproject(targetCrs: string): Promise<void>;
  /** @internal */
  _applyReprojectedView(crs: string, extent: Bounds): void;
}
