import { afterEach, describe, expect, it, vi } from 'vitest';
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawnSync: spawn }));
import { readAuditReport } from '../../scripts/audit-production-dependencies.mjs';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('production audit registry is independent of the install mirror', () => {
  it('uses an explicit official registry even when npm_config_registry points elsewhere', async () => {
    vi.stubEnv('npm_config_registry', 'https://registry.npmmirror.com');
    vi.stubEnv('EMAP_AUDIT_REGISTRY', '');
    const report = { metadata: { vulnerabilities: {} }, advisories: {} };
    spawn.mockReturnValue({ stdout: JSON.stringify(report), stderr: '', status: 0 });
    expect(await readAuditReport(process.cwd(), 1)).toEqual(report);
    expect(spawn.mock.calls[0][1]).toEqual([
      '--registry=https://registry.npmjs.org',
      'audit',
      '--json',
      '--prod',
    ]);
    expect(process.env.npm_config_registry).toBe('https://registry.npmmirror.com');
  });

  it('supports an explicit audit-only registry', async () => {
    vi.stubEnv('EMAP_AUDIT_REGISTRY', 'https://audit.example.test');
    spawn.mockReturnValue({ stdout: '{"metadata":{}}', stderr: '', status: 0 });
    await readAuditReport(process.cwd(), 1);
    expect(spawn.mock.calls[0][1][0]).toBe('--registry=https://audit.example.test');
  });

  it('still fails closed on registry failure', async () => {
    spawn.mockReturnValue({
      stdout: '{"error":{"message":"audit unavailable"}}',
      stderr: '',
      status: 1,
    });
    await expect(readAuditReport(process.cwd(), 1)).rejects.toThrow('audit unavailable');
  });
});
