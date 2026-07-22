import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function createConsumerPackage(): { consumerFile: string; declarationFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'emap-package-exports-'));
  const packageDirectory = join(directory, 'node_modules', '@zwishing', 'emap');
  const declarationFile = join(packageDirectory, 'dist', 'style.css.d.ts');
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true });
  writeFileSync(
    join(packageDirectory, 'package.json'),
    readFileSync(resolve(process.cwd(), 'package.json')),
  );
  writeFileSync(declarationFile, 'declare const css: string;\nexport default css;\n');

  temporaryDirectories.push(directory);
  return {
    consumerFile: join(directory, 'consumer.ts'),
    declarationFile: realpathSync(declarationFile),
  };
}

function resolveStyleDeclaration(consumerFile: string, moduleResolution: ts.ModuleResolutionKind) {
  return ts.resolveModuleName(
    '@zwishing/emap/style.css',
    consumerFile,
    { module: ts.ModuleKind.Node16, moduleResolution },
    ts.sys,
  ).resolvedModule?.resolvedFileName;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

describe('published CSS type declaration', () => {
  it('resolves for legacy Node10 and modern Node16 TypeScript consumers', () => {
    const { consumerFile, declarationFile } = createConsumerPackage();

    expect(resolveStyleDeclaration(consumerFile, ts.ModuleResolutionKind.Node10)).toBe(
      declarationFile,
    );
    expect(resolveStyleDeclaration(consumerFile, ts.ModuleResolutionKind.Node16)).toBe(
      declarationFile,
    );
  });

  it('includes the DuckDB module bundle in the publish whitelist', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      files: string[];
    };

    expect(manifest.files).toContain('dist/emap-duckdb.mjs');
  });
});
