import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('release documentation checklist', () => {
  it('keeps browser checks opt-in for CI and publishing', async () => {
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(manifest.scripts.prepublishOnly).toBe('npm run release:verify:local');
    const local = manifest.scripts['release:verify:local'];
    expect(local).not.toMatch(/browser:|playwright|test:rendering/);
    expect(manifest.scripts['release:verify']).toBe(
      'npm run release:verify:local && npm run browser:check',
    );
    const release = `${local} && npm run browser:check`;
    for (const gate of [
      'format:check',
      'typecheck',
      'api:check-surface',
      'build',
      'bundle:smoke',
      'test:run',
      'test:duckdb',
      'examples:build',
      'api:build',
      'examples:check',
      'browser:check',
      'audit:prod',
    ]) {
      expect(release.split(' && ')).toContain(`npm run ${gate}`);
    }
    expect(release).toContain('pnpm pack --dry-run');
    expect(manifest.scripts['browser:check']).toBe(
      'playwright test && node scripts/check-audit-rendering.mjs --all-browsers',
    );
    const steps = release.split(' && ');
    expect(steps.indexOf('npm run build')).toBeLessThan(steps.indexOf('npm run test:run'));
    expect(steps.indexOf('npm run examples:build')).toBeLessThan(
      steps.indexOf('npm run browser:check'),
    );
    for (const workflow of ['ci.yml', 'publish-npm.yml']) {
      const yaml = await readFile(resolve(process.cwd(), '.github/workflows', workflow), 'utf8');
      expect(yaml).toMatch(/^\s+(?:- )?run: pnpm run release:verify:local\s*$/m);
      expect(yaml).not.toMatch(/^\s+(?:- )?run: pnpm run release:verify\s*$/m);
      expect(yaml).not.toMatch(/browser:install|browser:check|playwright|check-browser-gpu/);
      if (workflow === 'publish-npm.yml') {
        expect(yaml.indexOf('run: pnpm run release:verify:local')).toBeLessThan(
          yaml.indexOf('run: npm publish'),
        );
      }
    }
    const browserWorkflow = await readFile(
      resolve(process.cwd(), '.github/workflows/browser-tests.yml'),
      'utf8',
    );
    const triggers = browserWorkflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1];
    expect(triggers?.trim()).toBe('workflow_dispatch:');
    expect(browserWorkflow).toMatch(/^\s+(?:- )?run: pnpm run release:verify\s*$/m);
    expect(browserWorkflow.indexOf('run: pnpm run browser:install')).toBeGreaterThan(-1);
    expect(browserWorkflow.indexOf('run: pnpm run browser:install')).toBeLessThan(
      browserWorkflow.indexOf('run: pnpm run release:verify'),
    );
  });

  it('lists every required release verification gate', async () => {
    const checklist = await readFile(resolve(process.cwd(), 'docs/release-checklist.md'), 'utf8');
    const manifest = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const gates = [
      'format:check',
      'typecheck',
      'api:check-surface',
      'test:run',
      'build',
      'bundle:smoke',
      'test:duckdb',
      'test:browser',
      'api:build',
      'examples:build',
      'api:build',
      'examples:check',
      'audit:prod',
    ];

    for (const gate of gates) {
      expect(checklist).toContain(gate);
      expect(manifest.scripts?.[gate]).toEqual(expect.any(String));
    }

    const examplesVerify = manifest.scripts?.['examples:verify'] ?? '';
    for (const gate of [
      'typecheck',
      'api:check-surface',
      'examples:build',
      'api:build',
      'examples:check',
    ]) {
      expect(examplesVerify).toContain(gate);
    }
  });
});
