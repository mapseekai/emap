import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
function example(path: string): string {
  const markdown = readFileSync(resolve(root, path), 'utf8');
  const blocks = [...markdown.matchAll(/```(?:ts|typescript)\s*\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((text) => text.includes('export async function cleanAndSimplify'));
  expect(blocks).toHaveLength(1);
  return blocks[0]!;
}

describe('README transaction examples match the live API', () => {
  it.each(['README.md', 'README.zh-CN.md'])('%s compiles against current source', (path) => {
    const code = example(path);
    const configPath = resolve(root, 'tsconfig.json');
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
    const options: ts.CompilerOptions = {
      ...parsed.options,
      noEmit: true,
      paths: { ...parsed.options.paths, '@mapseekai/emap': [resolve(root, 'src/index.ts')] },
    };
    const virtual = resolve(root, '__readme_audit_virtual__.ts');
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, fresh) =>
      resolve(name) === virtual
        ? ts.createSourceFile(name, code, languageVersion, true)
        : getSourceFile(name, languageVersion, onError, fresh);
    const program = ts.createProgram([...parsed.fileNames, virtual], options, host);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual(
      [],
    );
  }, 60_000);

  it.each([
    'clean',
    'simplify',
    'success',
    'throw',
  ] as const)('handles the %s path', async (scenario) => {
    // Execute only the trusted, checked-in documentation example, not user data.
    const compiled = ts.transpileModule(example('README.md'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    const exports: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- Executes this repository's compiled example fixture.
    new Function('exports', compiled)(exports);
    const ok = { ok: true, value: undefined };
    const failure = {
      ok: false,
      error: { kind: 'validation', field: 'target', reason: 'test failure' },
    };
    const transaction = {
      isOpen: true,
      rollback: vi.fn(() => {
        transaction.isOpen = false;
      }),
      commit: vi.fn(async () => {
        transaction.isOpen = false;
        return ok;
      }),
    };
    const map = {
      beginTransaction: () => transaction,
      ops: {
        cleanLayer: vi.fn(async () => {
          if (scenario === 'throw') throw new Error('Unexpected failure');
          return scenario === 'clean' ? failure : ok;
        }),
        simplifyLayer: vi.fn(async () => (scenario === 'simplify' ? failure : ok)),
      },
    };
    const result = exports.cleanAndSimplify!(map, 'source', 'layer');
    if (scenario === 'throw') await expect(result).rejects.toThrow('Unexpected failure');
    else expect(await result).toEqual(scenario === 'success' ? ok : failure);
    if (scenario === 'success') {
      expect(transaction.commit).toHaveBeenCalledWith('Clean and simplify');
      expect(transaction.rollback).not.toHaveBeenCalled();
    } else {
      expect(transaction.rollback).toHaveBeenCalledTimes(1);
      expect(transaction.commit).not.toHaveBeenCalled();
    }
    if (scenario === 'clean' || scenario === 'throw')
      expect(map.ops.simplifyLayer).not.toHaveBeenCalled();
    expect(map.ops.cleanLayer).toHaveBeenCalledWith({ source: 'source', target: 'layer' });
  });
});
