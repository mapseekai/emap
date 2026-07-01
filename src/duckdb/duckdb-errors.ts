export type DuckDbOperationErrorKind =
  | 'validation'
  | 'runtime-unavailable'
  | 'spatial-extension-unavailable'
  | 'query-failed'
  | 'conversion-failed';

export class DuckDbOperationError extends Error {
  readonly kind: DuckDbOperationErrorKind;
  readonly field?: string;

  constructor(
    kind: DuckDbOperationErrorKind,
    message: string,
    opts: { field?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'DuckDbOperationError';
    this.kind = kind;
    this.field = opts.field;
  }
}
