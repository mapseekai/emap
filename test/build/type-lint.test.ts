import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { resolve } from 'node:path';

describe('type-aware lint gate', () => {
  // Immutable CI Programs retain disk types when lintText replaces a file.
  const eslint = new ESLint({
    overrideConfig: {
      languageOptions: {
        parserOptions: { disallowAutomaticSingleRunInference: true },
      },
    },
  });

  it.each([
    ['Promise.reject(new Error("ignored"));', '@typescript-eslint/no-floating-promises'],
    ['const input: any = {}; input.call();', '@typescript-eslint/no-unsafe-call'],
    ['[1].forEach(async () => {});', '@typescript-eslint/no-misused-promises'],
    [
      'class Handler { run() { return this; } } const run = new Handler().run;',
      '@typescript-eslint/unbound-method',
    ],
    ['const input: any = {};', '@typescript-eslint/no-explicit-any'],
  ])(
    'rejects %s',
    async (source, rule) => {
      const [result] = await eslint.lintText(source, { filePath: 'src/ui/simplify-control.ts' });
      expect(result.messages.some((message) => message.ruleId === rule)).toBe(true);
      expect(result.messages.every((message) => !message.fatal)).toBe(true);
    },
    30_000,
  );

  it.each([
    'packages/docs/src/theme/MDXComponents/A/index.tsx',
    'vitest.config.ts',
  ])('checks Promise ownership in %s', async (filePath) => {
    const [result] = await eslint.lintText('Promise.resolve(1);', { filePath });
    expect(
      result.messages.some(
        (message) => message.ruleId === '@typescript-eslint/no-floating-promises',
      ),
    ).toBe(true);
    expect(result.messages.every((message) => !message.fatal)).toBe(true);
  }, 30_000);

  it('rejects unsafe ordinary deletion fixtures', async () => {
    const [result] = await eslint.lintText('const input: any = {}; input.call();', {
      filePath: 'src/domain/edit/commands/feature-delete.test.ts',
    });
    expect(result.messages.map((message) => message.ruleId)).toContain(
      '@typescript-eslint/no-unsafe-call',
    );
  }, 30_000);
});

describe('semantic TypeScript coverage', () => {
  function config(path: string) {
    const filename = resolve(path);
    const read = ts.readConfigFile(filename, ts.sys.readFile);
    expect(read.error).toBeUndefined();
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, resolve(filename, '..'));
    expect(parsed.errors).toEqual([]);
    return parsed;
  }

  it('includes every authored TS/TSX file in a checked project', () => {
    const covered = new Set(
      [
        'tsconfig.json',
        'tsconfig.test.json',
        'tsconfig.type-tests.json',
        'packages/examples/tsconfig.json',
        'packages/docs/tsconfig.json',
        'tsconfig.tooling.json',
      ].flatMap((path) => {
        const parsed = config(path);
        return ts
          .createProgram(parsed.fileNames, parsed.options)
          .getSourceFiles()
          .map((file) => file.fileName);
      }),
    );
    const files = ts.sys.readDirectory(
      process.cwd(),
      ['.ts', '.tsx', '.mts'],
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/.docusaurus/**',
        'packages/docs/build/**',
        '**/.worktrees/**',
        '**/.git/**',
      ],
      ['src/**/*', 'test/**/*', 'packages/**/*', 'docs-meta/**/*', '*.ts', '*.mts'],
    );
    expect(files.filter((path) => !covered.has(path))).toEqual([]);
  }, 30_000);

  it.each([
    ['packages/docs/tsconfig.json', 'packages/docs/sidebars.ts'],
    ['packages/docs/tsconfig.json', 'packages/docs/src/theme/MDXComponents/A/index.tsx'],
    ['tsconfig.tooling.json', 'vitest.config.ts'],
  ])('reports semantic errors in %s: %s', (project, path) => {
    const parsed = config(project);
    const filename = resolve(path);
    expect(parsed.fileNames).toContain(filename);
    const host = ts.createCompilerHost(parsed.options);
    const readFile = host.readFile.bind(host);
    const probe = path.endsWith('.tsx')
      ? '\nexport const typecheckProbe = <MDXA href={123} />;\n'
      : '\nexport const typecheckProbe: number = "invalid";\n';
    host.readFile = (file) => (file === filename ? readFile(file) + probe : readFile(file));
    const program = ts.createProgram(parsed.fileNames, parsed.options, host);
    expect(
      program
        .getSemanticDiagnostics(program.getSourceFile(filename))
        .some((diagnostic) => diagnostic.code === 2322),
    ).toBe(true);
  });
});
