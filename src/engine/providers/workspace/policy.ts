import { EventDispatcher } from '../../core/events';
import { type ExpressionEvaluationPolicy } from '../../map/types';

interface Dependencies {
  events: EventDispatcher;
}

/** policy implementation, wired through explicit service dependencies. */
export class ExpressionPolicyService {
  _expressionPolicy: ExpressionEvaluationPolicy = 'disabled';

  public setExpressionPolicy(policy: ExpressionEvaluationPolicy): void {
    this._expressionPolicy = policy;
  }

  public getExpressionPolicy(): ExpressionEvaluationPolicy {
    return this._expressionPolicy ?? 'disabled';
  }

  _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean {
    const hasExpression = values.some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
    // No expression payload → always allowed regardless of policy.
    // Policy is `'trusted'` → opt-in, allowed. Anything else → block.
    if (!hasExpression || this.getExpressionPolicy() === 'trusted') return true;
    this.deps.events.fire('error', {
      error: new Error(`${operation}: expression evaluation is disabled`),
    });
    return false;
  }

  constructor(private readonly deps: Dependencies) {}
}
