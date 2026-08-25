export class SplitGeometryValidationError extends Error {
  constructor(
    readonly field: 'cutter' | 'geometry',
    readonly reason: string,
  ) {
    super(reason);
    this.name = 'SplitGeometryValidationError';
  }
}
