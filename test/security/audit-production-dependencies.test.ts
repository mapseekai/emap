import { describe, expect, it } from 'vitest';
import { evaluateAuditReport } from '../../scripts/audit-production-dependencies.mjs';

const allowlist = {
  expiresOn: '2026-12-31',
  minimumSeverity: 'high',
  allowedAdvisoryIds: ['1234'],
  allowedFindingPrefixes: ['packages/docs>', 'packages__docs>', '@mapseekai/emap-docs>'],
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
  it('allows high findings only when every path belongs to the docs workspace', () => {
    expect(
      evaluateAuditReport(
        report('packages/docs>@docusaurus/core>webpack-dev-server'),
        allowlist,
        new Date('2026-09-04T00:00:00Z'),
      ),
    ).toEqual({
      allowed: [
        {
          id: '1234',
          severity: 'high',
          path: 'packages/docs>@docusaurus/core>webpack-dev-server',
        },
      ],
      blocking: [],
    });
  });

  it('blocks unapproved high advisory ids even on documentation paths', () => {
    const result = evaluateAuditReport(
      {
        advisories: {
          '9999': {
            severity: 'high',
            findings: [{ paths: ['packages/docs>@docusaurus/core>new-vulnerability'] }],
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
        path: 'packages/docs>@docusaurus/core>new-vulnerability',
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

  it('fails closed when the temporary docs allowlist expires', () => {
    expect(() =>
      evaluateAuditReport(
        report('packages/docs>@docusaurus/core>webpack-dev-server'),
        allowlist,
        new Date('2027-01-01T00:00:00Z'),
      ),
    ).toThrow(/expired on 2026-12-31/);
  });
});
