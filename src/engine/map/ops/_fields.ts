import { findInvalidFieldName, isValidFieldName } from '../command-args';
import { Err, okValue, type OpResult } from '../op-result';

export function validateFieldName(optionName: string, value: unknown): OpResult<string> {
  if (!isValidFieldName(value)) {
    return Err.validation(
      optionName,
      `field name must be a non-empty safe identifier: ${String(value)}`,
    );
  }
  return okValue(value);
}

export function validateFieldList(optionName: string, values: unknown): OpResult<string[]> {
  if (values == null) return okValue([]);
  if (!Array.isArray(values)) {
    return Err.validation(optionName, 'must be an array');
  }
  const invalid = findInvalidFieldName(values);
  if (invalid !== null) {
    return Err.validation(optionName, `field name must be a non-empty safe identifier: ${invalid}`);
  }
  return okValue(values.slice() as string[]);
}
