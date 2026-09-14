import type { ValidatorRegistry } from '../../validation/registry';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface ValidationContract {
  readonly validators: ValidatorRegistry;
  /** @internal */
  _runAfterCommitValidators(): void;
  dispose(): void;
}
