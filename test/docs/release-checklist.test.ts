import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release documentation checklist', () => {
  it('lists every required release verification gate', async () => {
    const checklist = await readFile(resolve(process.cwd(), 'docs/release-checklist.md'), 'utf8');
    const gates = [
      'typecheck',
      'test:run',
      'test:duckdb',
      'api:build',
      'examples:build',
      'docs:build',
      'docs:check-i18n',
      'docs:check-api',
      'examples:check',
    ];

    for (const gate of gates) {
      expect(checklist).toContain(gate);
    }
  });
});
