import { describe, expect, it } from 'vitest';
import { evaluateAuditReport } from '../../scripts/audit-production-dependencies.mjs';

const allowlist = {
  expiresOn: '2026-12-31',
  minimumSeverity: 'high',
  allowedAdvisoryIds: ['1234'],
  allowedFindingPrefixes: ['tooling-fixture>', 'tooling_fixture>', '@test/tooling>'],
};

function report(path: string, severity = 'high') {
  return {
    advisories: {
      '1234': {
        severity,
        findings: [{ paths: [path] }],
      },
    },
    metadata: { vulnerabilities: { high: severity === 'high' ? 1 : 0 } },
  };
}

describe('production dependency audit allowlist', () => {
  it('requires no expiry when there are no exceptions and blocks all high findings', () => {
    const empty = { allowedAdvisoryIds: [], allowedFindingPrefixes: [] };
    const future = new Date('2030-01-01T00:00:00Z');
    expect(evaluateAuditReport({ metadata: { vulnerabilities: {} } }, empty, future)).toEqual({
      allowed: [],
      blocking: [],
    });
    const result = evaluateAuditReport(report('tooling-fixture>vulnerable-package'), empty, future);
    expect(result.allowed).toEqual([]);
    expect(result.blocking).toHaveLength(1);
  });

  it('allows high findings only when every path belongs to the approved fixture', () => {
    expect(
      evaluateAuditReport(
        report('tooling-fixture>toolchain>vulnerable-package'),
        allowlist,
        new Date('2026-09-04T00:00:00Z'),
      ),
    ).toEqual({
      allowed: [
        {
          id: '1234',
          severity: 'high',
          path: 'tooling-fixture>toolchain>vulnerable-package',
        },
      ],
      blocking: [],
    });
  });

  it('never allows critical findings even when the id and fixture path were approved', () => {
    const result = evaluateAuditReport(
      report('tooling-fixture>toolchain>vulnerable-package', 'critical'),
      allowlist,
      new Date('2026-09-04T00:00:00Z'),
    );
    expect(result.allowed).toEqual([]);
    expect(result.blocking).toHaveLength(1);
  });

  it('blocks unapproved high advisory ids even on approved paths', () => {
    const result = evaluateAuditReport(
      {
        advisories: {
          '9999': {
            severity: 'high',
            findings: [{ paths: ['tooling-fixture>toolchain>new-vulnerability'] }],
          },
        },
        metadata: { vulnerabilities: { high: 1 } },
      },
      allowlist,
      new Date('2026-09-04T00:00:00Z'),
    );

    expect(result.allowed).toEqual([]);
    expect(result.blocking).toEqual([
      {
        id: '9999',
        severity: 'high',
        path: 'tooling-fixture>toolchain>new-vulnerability',
      },
    ]);
  });

  it('blocks high findings reachable from the published runtime graph', () => {
    const result = evaluateAuditReport(
      report('.>@mapseekai/emap>mapshaper>vulnerable-package'),
      allowlist,
      new Date('2026-09-04T00:00:00Z'),
    );

    expect(result.allowed).toEqual([]);
    expect(result.blocking).toEqual([
      {
        id: '1234',
        severity: 'high',
        path: '.>@mapseekai/emap>mapshaper>vulnerable-package',
      },
    ]);
  });

  it('fails closed when pnpm returns a registry or audit error object', () => {
    expect(() =>
      evaluateAuditReport(
        { error: { message: 'The operation was aborted due to timeout' } },
        allowlist,
        new Date('2026-09-04T00:00:00Z'),
      ),
    ).toThrow(/pnpm audit failed: The operation was aborted due to timeout/);
  });

  it('fails closed when vulnerability metadata is missing', () => {
    expect(() =>
      evaluateAuditReport({ advisories: {} }, allowlist, new Date('2026-09-04T00:00:00Z')),
    ).toThrow(/missing vulnerability metadata/);
  });

  it('fails closed when the temporary allowlist expires', () => {
    expect(() =>
      evaluateAuditReport(
        report('tooling-fixture>toolchain>vulnerable-package'),
        allowlist,
        new Date('2027-01-01T00:00:00Z'),
      ),
    ).toThrow(/expired on 2026-12-31/);
  });
});
