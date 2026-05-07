import { describe, expect, it } from 'vitest';
import {
  findInvalidFieldName,
  isValidFieldName,
  isValidLayerName,
  quoteCliArg,
} from './command-args';

describe('quoteCliArg', () => {
  it('wraps simple alphanumerics in plain double quotes', () => {
    expect(quoteCliArg('parcels')).toBe('"parcels"');
    expect(quoteCliArg('layer-1')).toBe('"layer-1"');
  });

  it('escapes embedded double quotes', () => {
    expect(quoteCliArg('he said "hi"')).toBe('"he said \\"hi\\""');
  });

  it('escapes embedded backslashes BEFORE escaping quotes (order matters)', () => {
    // A naive `\\` → `\\\\` after `"` → `\\"` would double-escape and break.
    // Verify the order produces a single `\\` for each input `\`.
    expect(quoteCliArg('a\\b')).toBe('"a\\\\b"');
    expect(quoteCliArg('a\\"b')).toBe('"a\\\\\\"b"');
  });

  it('escapes newline / carriage return / tab / NUL', () => {
    expect(quoteCliArg('a\nb')).toBe('"a\\nb"');
    expect(quoteCliArg('a\rb')).toBe('"a\\rb"');
    expect(quoteCliArg('a\tb')).toBe('"a\\tb"');
    expect(quoteCliArg('a\0b')).toBe('"a\\0b"');
  });

  it('round-trips through mapshaper-style un-quoting (regression: pre-PR-4 leaked unescaped backslashes)', () => {
    // Simulate mapshaper's CLI parser stripping the outer quotes and
    // un-escaping `\X` back to `X` for `\\` and `\"`. The result should
    // match the original input — pre-PR-4 with only `"` escaped, an input
    // ending in `\` would corrupt the next argument.
    const inputs = [
      'simple',
      'with space',
      'quote: "inside"',
      'back\\slash',
      'mixed "back\\slash"',
      'trailing\\',
    ];
    for (const original of inputs) {
      const quoted = quoteCliArg(original);
      // Strip outer double quotes
      expect(quoted.startsWith('"')).toBe(true);
      expect(quoted.endsWith('"')).toBe(true);
      const inner = quoted.slice(1, -1);
      // Un-escape: `\\` → `\`, `\"` → `"`. Process left-to-right so we
      // don't accidentally collapse `\\\"` into `\"`.
      let restored = '';
      for (let i = 0; i < inner.length; i++) {
        if (inner[i] === '\\' && i + 1 < inner.length) {
          const next = inner[i + 1];
          if (next === '\\') restored += '\\';
          else if (next === '"') restored += '"';
          else if (next === 'n') restored += '\n';
          else if (next === 'r') restored += '\r';
          else if (next === 't') restored += '\t';
          else if (next === '0') restored += '\0';
          else restored += next;
          i++;
        } else {
          restored += inner[i];
        }
      }
      expect(restored).toBe(original);
    }
  });
});

describe('isValidLayerName', () => {
  it.each([
    ['parcels', true],
    ['layer_1', true],
    ['layer-1', true],
    ['ns:layer', true],
    ['my.layer', true],
    ['name with space', true],
    ['行政区', true], // CJK
    ['', false],
    ['has=equal', false],
    ['has,comma', false],
    ['has\\backslash', false],
    ['has"quote', false],
    ['has\nnewline', false],
    ['has<bracket', false],
    [' leading-space', false],
    ['1starts-with-digit', true], // digit allowed at start
    [null, false],
    [undefined, false],
    [42, false],
  ])('isValidLayerName(%p) === %p', (input, expected) => {
    expect(isValidLayerName(input)).toBe(expected);
  });
});

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
