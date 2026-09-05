import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEVERITY_RANK = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function normalizedPath(value) {
  return String(value).replaceAll('\\', '/');
}

function findingPaths(advisory) {
  const paths = [];
  for (const finding of advisory.findings ?? []) {
    for (const path of finding.paths ?? []) paths.push(normalizedPath(path));
  }
  for (const node of advisory.nodes ?? []) paths.push(normalizedPath(node));
  return [...new Set(paths)];
}

function isAllowedPath(path, prefixes) {
  const normalized = normalizedPath(path);
  return prefixes.some((prefix) => normalized.startsWith(prefix));
}

function collectAdvisories(report) {
  if (report?.advisories && typeof report.advisories === 'object') {
    return Object.entries(report.advisories).map(([id, advisory]) => ({ id, ...advisory }));
  }

  if (report?.vulnerabilities && typeof report.vulnerabilities === 'object') {
    return Object.entries(report.vulnerabilities).map(([id, advisory]) => ({ id, ...advisory }));
  }

  return [];
}

export function evaluateAuditReport(report, allowlist, now = new Date()) {
  if (report?.error) {
    const message =
      typeof report.error === 'string'
        ? report.error
        : report.error.message ?? JSON.stringify(report.error);
    throw new Error(`pnpm audit failed: ${message}`);
  }
  if (!report?.metadata || typeof report.metadata !== 'object') {
    throw new Error('pnpm audit report is missing vulnerability metadata');
  }

  const minimumSeverity = allowlist.minimumSeverity ?? 'high';
  const minimumRank = SEVERITY_RANK[minimumSeverity];
  if (minimumRank === undefined) {
    throw new Error(`Unsupported audit severity '${minimumSeverity}'`);
  }

  const expiry = new Date(`${allowlist.expiresOn}T23:59:59.999Z`);
  if (!Number.isFinite(expiry.getTime())) {
    throw new Error('security/audit-allowlist.json contains an invalid expiresOn date');
  }
  if (now.getTime() > expiry.getTime()) {
    throw new Error(`Documentation audit allowlist expired on ${allowlist.expiresOn}`);
  }

  const prefixes = allowlist.allowedFindingPrefixes ?? [];
  const approvedIds = new Set((allowlist.allowedAdvisoryIds ?? []).map(String));
  const blocking = [];
  const allowed = [];

  for (const advisory of collectAdvisories(report)) {
    const severity = advisory.severity ?? 'info';
    const rank = SEVERITY_RANK[severity] ?? Number.POSITIVE_INFINITY;
    if (rank < minimumRank) continue;

    const paths = findingPaths(advisory);
    if (paths.length === 0) {
      blocking.push({ id: advisory.id, severity, path: '<unclassified>' });
      continue;
    }

    for (const path of paths) {
      const finding = { id: String(advisory.id), severity, path };
      if (
        severity === 'high' &&
        approvedIds.has(String(advisory.id)) &&
        isAllowedPath(path, prefixes)
      ) {
        allowed.push(finding);
      } else {
        blocking.push(finding);
      }
    }
  }

  const metadata = report?.metadata?.vulnerabilities ?? report?.metadata ?? {};
  const reportedAtOrAboveThreshold = Object.entries(metadata).some(
    ([severity, count]) =>
      (SEVERITY_RANK[severity] ?? -1) >= minimumRank && Number(count) > 0,
  );
  if (collectAdvisories(report).length === 0 && reportedAtOrAboveThreshold) {
    blocking.push({ id: '<metadata-only>', severity: minimumSeverity, path: '<unclassified>' });
  }

  return { allowed, blocking };
}

const sleep = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

export async function readAuditReport(root, attempts = 3) {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  // pnpm run can re-inject the installation registry into the child environment.
  // A command-line registry keeps security auditing independent of that mirror.
  const registry = process.env.EMAP_AUDIT_REGISTRY || 'https://registry.npmjs.org';
  let lastFailure = 'unknown audit failure';

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const audit = spawnSync(pnpm, [`--registry=${registry}`, 'audit', '--json', '--prod'], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    try {
      const report = JSON.parse(audit.stdout);
      if (!report?.error) return report;
      lastFailure = report.error.message ?? JSON.stringify(report.error);
    } catch {
      lastFailure = [audit.stdout, audit.stderr].filter(Boolean).join('\n').trim();
    }

    if (attempt < attempts) {
      console.warn(`pnpm audit attempt ${attempt} failed; retrying...`);
      await sleep(attempt * 2_000);
    }
  }

  throw new Error(`Unable to obtain a valid pnpm audit report: ${lastFailure}`);
}

async function main() {
  const root = process.cwd();
  const allowlist = JSON.parse(
    await readFile(resolve(root, 'security/audit-allowlist.json'), 'utf8'),
  );
  const report = await readAuditReport(root);
  const { allowed, blocking } = evaluateAuditReport(report, allowlist);
  if (blocking.length > 0) {
    const details = blocking
      .map(({ id, severity, path }) => `- ${severity} advisory ${id}: ${path}`)
      .join('\n');
    throw new Error(`Production dependency audit found unapproved findings:\n${details}`);
  }

  console.log(
    `Production dependency audit passed; ${allowed.length} documentation-only finding path(s) are temporarily allowed until ${allowlist.expiresOn}.`,
  );
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  await main();
}
