import { describe, expect, it } from 'vitest';
import { findInvalidFieldName, isValidFieldName } from './command-args';

describe('isValidFieldName', () => {
  it.each([
    ['name', true],
    ['pop_2020', true],
    ['area-km2', true],
    ['my.field', true],
    ['行政编码', true],
    ['', false],
    ['has=equal', false],
    ['has,comma', false],
    ['has:colon', false], // stricter than layer names
    ['has"quote', false],
    ['has\\backslash', false],
    ['has\0nul', false],
  ])('isValidFieldName(%p) === %p', (input, expected) => {
    expect(isValidFieldName(input)).toBe(expected);
  });
});

describe('findInvalidFieldName', () => {
  it('returns null when every name is valid', () => {
    expect(findInvalidFieldName(['a', 'b_2', 'c-3'])).toBeNull();
  });

  it('returns the first offending name', () => {
    expect(findInvalidFieldName(['a', 'has,comma', 'has=eq'])).toBe('has,comma');
  });

  it('coerces non-string offenders to a string for diagnostics', () => {
    expect(findInvalidFieldName(['a', 42 as unknown as string])).toBe('42');
  });

  it('treats an empty list as valid (caller decides whether to reject)', () => {
    expect(findInvalidFieldName([])).toBeNull();
  });
});
