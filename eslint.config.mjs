import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '.worktrees/**',
    'dist/**',
    'test-results/**',
    '**/node_modules/**',
    '**/*.test-d.ts',
    'packages/examples/dist/**',
  ]),
  {
    files: [
      'src/**/*.ts',
      'test/**/*.ts',
      'packages/examples/**/*.ts',
      'docs-meta/**/*.ts',
      '*.ts',
    ],
    ignores: ['**/*.d.ts'],
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.lint.json', './tsconfig.tooling.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Async implementations and test doubles may only establish rejection semantics.
      '@typescript-eslint/require-await': 'off',
      // Indexed-access assertions remain meaningful until the stricter index option is adopted.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Adopt Promise ownership and unsafe-any checks first; keep other style rules in Biome/tsc.
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-enum-comparison': 'off',
      '@typescript-eslint/await-thenable': 'off',
      // Unknown rejection reasons include the platform's caller-controlled AbortSignal.reason.
      '@typescript-eslint/prefer-promise-reject-errors': [
        'error',
        { allowThrowingUnknown: true, allowThrowingAny: true },
      ],
    },
  },
  {
    files: [
      'src/integrations/mapshaper/adapter.ts',
      'src/integrations/mapshaper/binary.ts',
      'src/engine/worker/mapshaper-worker.ts',
      'src/engine/core/mapshaper-worker-pool.ts',
      'src/integrations/tasklane/runtime.ts',
      'src/integrations/luma/geometry-worker.ts',
      'src/integrations/msdf/client.ts',
      'src/integrations/arrow/geometry-column.ts',
      'src/integrations/arrow/table-to-dataset.ts',
      'src/integrations/arrow/dataset-to-table.ts',
      'src/shared/types/iconv-shim.ts',
      'packages/examples/src/mapshaper-global.ts',
    ],
    rules: {
      // These modules adapt third-party objects and Worker payloads with incomplete upstream types.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
  {
    files: ['**/*.test.ts', 'test/**/*.ts'],
    rules: {
      // Vitest inspects methods and deliberately constructs invalid boundary inputs.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/prefer-promise-reject-errors': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
  {
    files: ['src/domain/edit/commands/feature-delete.test.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
    },
  },
);
