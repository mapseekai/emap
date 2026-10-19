import { EventDispatcher } from '../../core/events';
import type { EmapHostInternal } from '../../map/emap-host';
import { ValidatorRegistry } from '../../../domain/validation/registry';
import type { DocumentContract as WorkspaceDocument } from '../../../runtime/services/contracts/document';

interface Dependencies {
  document: Pick<WorkspaceDocument, '_history' | '_removed'>;
  events: EventDispatcher;
  host: EmapHostInternal;
  signal: AbortSignal;
}

/** validation implementation, wired through explicit service dependencies. */
export class ValidationServiceImpl {
  readonly validators: ValidatorRegistry = new ValidatorRegistry();

  _runAfterCommitValidators(): void {
    // A capture-state notification updates history controls, not committed data.
    if (this.validators.size === 0 || this.deps.document._history.isCapturing()) return;
    const top = this.deps.document._history.snapshot();
    const change = { label: top.label ?? '' };
    void this.validators
      .runFor('after-commit', this.deps.host, change)
      .then((results) => {
        if (this.deps.document._removed || this.deps.signal.aborted) return;
        const failed = results.filter((r) => !r.report.ok);
        if (failed.length > 0) {
          this.deps.events.fire('validationfailed', { results: failed, label: change.label });
        }
      })
      .catch((error: unknown) => {
        if (!this.deps.document._removed && !this.deps.signal.aborted)
          this.deps.events.fire('error', { error });
      });
  }

  dispose(): void {
    this.validators.unregisterAll();
  }

  constructor(private readonly deps: Dependencies) {}
}
