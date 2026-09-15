import { describe, expect, it } from 'vitest';
import { operationSchemas } from './generated-schemas';

describe('JSON capability schemas', () => {
  it('never serializes compiler-generated Symbol property identifiers', () => {
    const json = JSON.stringify(operationSchemas);
    expect(json).not.toMatch(/__@[^"\s]+@\d+/);
  });
});
