import { describe, expect, it } from 'vitest';
import { validateFieldList } from './_fields';

describe('validateFieldList', () => {
  it.each([
    '',
    0,
    false,
    {},
    { length: 0 },
  ])('rejects a non-array value %j instead of treating it as an empty list', (value) => {
    expect(validateFieldList('fields', value)).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'fields' },
    });
  });

  it('checks the array type before reading an untrusted length', () => {
    const value = {
      get length(): never {
        throw new Error('length must not be read');
      },
    };
    expect(validateFieldList('copyFields', value)).toMatchObject({
      ok: false,
      error: { kind: 'validation', field: 'copyFields' },
    });
  });

  it('keeps omitted and empty lists optional and copies valid field names', () => {
    expect(validateFieldList('fields', undefined)).toEqual({ ok: true, value: [] });
    expect(validateFieldList('fields', null)).toEqual({ ok: true, value: [] });
    expect(validateFieldList('fields', [])).toEqual({ ok: true, value: [] });
    const fields = ['region', '人口', 'population 2020'];
    const result = validateFieldList('fields', fields);
    expect(result).toEqual({ ok: true, value: fields });
    if (result.ok) expect(result.value).not.toBe(fields);
  });
});
