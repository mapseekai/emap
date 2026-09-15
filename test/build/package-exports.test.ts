import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];

function createConsumerPackage(): { consumerFile: string; declarationFile: string } {
  const directory = mkdtempSync(join(tmpdir(), 'emap-package-exports-'));
  const packageDirectory = join(directory, 'node_modules', '@mapseekai', 'emap');
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
    '@mapseekai/emap/style.css',
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

describe('published plugin architecture subpaths', () => {
  it('publishes every explicit architecture entry point', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      exports: Record<string, { types?: string; import?: string } | string>;
    };
    for (const name of [
      'context',
      'services',
      'providers',
      'plugins',
      'presets',
      'ai',
      'maplibre',
      'geopackage',
    ]) {
      expect(manifest.exports[`./${name}`]).toMatchObject({
        types: expect.stringContaining('.d.ts'),
        import: expect.stringContaining('.mjs'),
      });
    }
  });
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

  it('keeps optional providers out of core dependencies', () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };

    for (const name of ['@duckdb/duckdb-wasm', 'apache-arrow', 'parquet-wasm', 'maplibre-gl']) {
      expect(manifest.dependencies).not.toHaveProperty(name);
      expect(manifest.peerDependencies?.[name]).toEqual(expect.any(String));
      expect(manifest.peerDependenciesMeta?.[name]?.optional).toBe(true);
    }
  });
});
