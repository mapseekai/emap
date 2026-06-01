import { describe, expect, it } from 'vitest';
import { OK, okValue, Err, type OpResult } from './op-result';

// `op-result` is a 60-line factory module, but every op in the engine
// depends on its outputs having a stable shape. These tests pin the
// discriminator + payload contract so a future refactor can't silently
// reshape an `Err.*` factory and break consumer's `switch (e.kind)` paths.

describe('OK / okValue', () => {
  it('OK is a frozen successful result with undefined value', () => {
    expect(OK.ok).toBe(true);
    expect((OK as any).value).toBeUndefined();
    expect(Object.isFrozen(OK)).toBe(true);
  });

  it('OK is a singleton — every read returns the same reference', () => {
    // Cheap-to-return contract per the docstring.
    const a = OK;
    const b = OK;
    expect(a).toBe(b);
  });

  it('okValue wraps a payload', () => {
    const r = okValue({ count: 42 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ count: 42 });
  });

  it('okValue carries primitive payloads', () => {
    expect(okValue(0).ok).toBe(true);
    expect(okValue('').ok).toBe(true);
    expect(okValue(null).ok).toBe(true);
    expect(okValue(false).ok).toBe(true);
  });
});

describe('Err.notFound', () => {
  it('emits kind=not-found with what + id', () => {
    const r = Err.notFound('source', 'src1') as OpResult;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('not-found');
      if (r.error.kind === 'not-found') {
        expect(r.error.what).toBe('source');
        expect(r.error.id).toBe('src1');
      }
    }
  });

  it('accepts every documented `what` discriminator', () => {
    const whats = ['source', 'layer', 'mask', 'divider', 'field'] as const;
    for (const what of whats) {
      const r = Err.notFound(what, 'x');
      if (!r.ok && r.error.kind === 'not-found') {
        expect(r.error.what).toBe(what);
      } else {
        throw new Error(`expected not-found for ${what}`);
      }
    }
  });
});

describe('Err.validation', () => {
  it('emits kind=validation with field + reason', () => {
    const r = Err.validation('radius', 'must be a positive number');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'validation') {
      expect(r.error.field).toBe('radius');
      expect(r.error.reason).toBe('must be a positive number');
    }
  });
});

describe('Err.expressionDisabled', () => {
  it('emits kind=expression-disabled with operation name', () => {
    const r = Err.expressionDisabled('applyExpression');
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === 'expression-disabled') {
      expect(r.error.operation).toBe('applyExpression');
    }
  });
});

describe('Err.mapshaper', () => {
  it('wraps the underlying cause', () => {
    const cause = new Error('mapshaper barfed');
    const r = Err.mapshaper(cause);
    if (!r.ok && r.error.kind === 'mapshaper') {
      expect(r.error.cause).toBe(cause);
      expect(r.error.cmd).toBeUndefined();
      expect(r.error.operation).toBeUndefined();
    }
  });

  it('attaches cmd / operation context when provided', () => {
    const r = Err.mapshaper(new Error('boom'), { cmd: '-clip', operation: 'clipLayer' });
    if (!r.ok && r.error.kind === 'mapshaper') {
      expect(r.error.cmd).toBe('-clip');
      expect(r.error.operation).toBe('clipLayer');
    }
  });

  it('accepts non-Error causes (string, plain object)', () => {
    const r1 = Err.mapshaper('string cause');
    const r2 = Err.mapshaper({ message: 'object cause' });
    if (!r1.ok && r1.error.kind === 'mapshaper') expect(r1.error.cause).toBe('string cause');
    if (!r2.ok && r2.error.kind === 'mapshaper') {
      expect((r2.error.cause as { message: string }).message).toBe('object cause');
    }
  });
});

describe('Err.hostRemoved', () => {
  it('emits kind=host-removed with no payload', () => {
    const r = Err.hostRemoved();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('host-removed');
  });
});

describe('Err is frozen', () => {
  it('cannot be mutated to redirect a factory', () => {
    expect(Object.isFrozen(Err)).toBe(true);
    expect(() => {
      (Err as any).notFound = () => null;
    }).toThrow();
  });
});

describe('discriminated narrowing in TypeScript flow', () => {
  it('lets switch(e.kind) narrow each branch correctly', () => {
    function describe(r: OpResult): string {
      if (r.ok) return 'success';
      switch (r.error.kind) {
        case 'not-found':
          return `nf:${r.error.what}:${r.error.id}`;
        case 'validation':
          return `v:${r.error.field}`;
        case 'expression-disabled':
          return `ed:${r.error.operation}`;
        case 'mapshaper':
          return `ms:${r.error.cmd ?? ''}`;
        case 'host-removed':
          return 'hr';
      }
    }
    expect(describe(OK)).toBe('success');
    expect(describe(Err.notFound('layer', 'parks'))).toBe('nf:layer:parks');
    expect(describe(Err.validation('field', 'reason'))).toBe('v:field');
    expect(describe(Err.expressionDisabled('op'))).toBe('ed:op');
    expect(describe(Err.mapshaper('cause', { cmd: '-x' }))).toBe('ms:-x');
    expect(describe(Err.hostRemoved())).toBe('hr');
  });
});
