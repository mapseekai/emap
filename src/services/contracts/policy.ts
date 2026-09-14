import type { ExpressionEvaluationPolicy } from '../../map/types';

/** Explicit service contract. Providers implement this boundary; consumers do not import implementations. */
export interface PolicyContract {
  /** @internal */
  _expressionPolicy: ExpressionEvaluationPolicy;
  setExpressionPolicy(policy: ExpressionEvaluationPolicy): void;
  getExpressionPolicy(): ExpressionEvaluationPolicy;
  /** @internal */
  _allowExpressionEvaluation(values: Array<string | undefined>, operation: string): boolean;
}
