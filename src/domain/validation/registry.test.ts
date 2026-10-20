import { describe, expect, it, vi, type Mock } from 'vitest';
import { ValidatorRegistry } from './registry';
import type { Validator, ValidationReport } from './validator';
import { makeStubCtx } from '../../../test/utils/map-ops';

const fakeHost = makeStubCtx().ctx.host;

function makeValidator(
  name: string,
  result: ValidationReport | (() => Promise<ValidationReport>) | (() => never),
  phase: 'after-commit' = 'after-commit',
): Validator & { run: Mock<Validator['run']> } {
  const run = vi.fn<Validator['run']>(() => {
    if (typeof result === 'function') return result();
    return Promise.resolve(result);
  });
  return { name, phase, run };
}

const okReport: ValidationReport = { ok: true, issues: [] };
const failReport: ValidationReport = {
  ok: false,
  issues: [{ severity: 'error', message: 'boom' }],
};

describe('ValidatorRegistry', () => {
  it('starts empty', () => {
    const r = new ValidatorRegistry();
    expect(r.size).toBe(0);
  });

  it('register grows size; the unregister callback removes exactly that validator', () => {
    const r = new ValidatorRegistry();
    const a = makeValidator('a', okReport);
    const b = makeValidator('b', okReport);
    const unA = r.register(a);
    r.register(b);
    expect(r.size).toBe(2);
    unA();
    expect(r.size).toBe(1);
    // Idempotent — calling unregister twice is a no-op.
    unA();
    expect(r.size).toBe(1);
  });

  it('unregisterAll wipes the registry', () => {
    const r = new ValidatorRegistry();
    r.register(makeValidator('a', okReport));
    r.register(makeValidator('b', okReport));
    r.unregisterAll();
    expect(r.size).toBe(0);
  });

  it('runFor returns [] when registry is empty', async () => {
    const r = new ValidatorRegistry();
    expect(await r.runFor('after-commit', fakeHost, { label: '' })).toEqual([]);
  });

  it('runFor invokes every matching-phase validator with the provided host + change', async () => {
    const r = new ValidatorRegistry();
    const a = makeValidator('a', okReport);
    const b = makeValidator('b', okReport);
    r.register(a);
    r.register(b);
    const change = { label: 'Did the thing' };
    const results = await r.runFor('after-commit', fakeHost, change);
    expect(results).toHaveLength(2);
    expect(a.run).toHaveBeenCalledWith(fakeHost, change);
    expect(b.run).toHaveBeenCalledWith(fakeHost, change);
  });

  it('runFor surfaces failures in the report', async () => {
    const r = new ValidatorRegistry();
    r.register(makeValidator('ok', okReport));
    r.register(makeValidator('bad', failReport));
    const results = await r.runFor('after-commit', fakeHost, { label: '' });
    expect(results.find((x) => x.validator === 'ok')!.report.ok).toBe(true);
    expect(results.find((x) => x.validator === 'bad')!.report.ok).toBe(false);
  });

  it('a thrown error from one validator does not poison the rest', async () => {
    const r = new ValidatorRegistry();
    r.register(
      makeValidator('throws', () => {
        throw new Error('exploded');
      }),
    );
    r.register(makeValidator('ok', okReport));
    const results = await r.runFor('after-commit', fakeHost, { label: '' });
    expect(results).toHaveLength(2);
    const thrown = results.find((x) => x.validator === 'throws')!;
    expect(thrown.report.ok).toBe(false);
    expect(thrown.report.issues[0].message).toMatch(/exploded/);
    expect(results.find((x) => x.validator === 'ok')!.report.ok).toBe(true);
  });

  it('runs validators in parallel (not sequential)', async () => {
    const r = new ValidatorRegistry();
    const order: string[] = [];
    r.register({
      name: 'slow',
      phase: 'after-commit',
      async run() {
        await sleep(20);
        order.push('slow');
        return okReport;
      },
    });
    r.register({
      name: 'fast',
      phase: 'after-commit',
      async run() {
        await sleep(0);
        order.push('fast');
        return okReport;
      },
    });
    await r.runFor('after-commit', fakeHost, { label: '' });
    // If sequential, slow would land before fast in registration order.
    // Parallel execution lets fast finish first.
    expect(order[0]).toBe('fast');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
