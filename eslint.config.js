import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const PURE_MESSAGE = 'Engine/strategy are pure: no clock, no environment, no I/O (spec 3.4).';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      'external/',
      'recordings/',
      '**/.stryker-tmp/',
      '**/reports/',
      'apps/bridge/src/features/index.generated.ts',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
  },
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', 'test-support/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/engine/src/**/*.ts', 'packages/strategy/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'process', 'setTimeout', 'setInterval', 'fetch'].map((name) => ({
          name,
          message: PURE_MESSAGE,
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded Rng (engine/src/util/rng.ts).' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'os', 'net', 'dgram', 'child_process', 'worker_threads'],
              message: 'Engine/strategy do no I/O.',
            },
          ],
        },
      ],
    },
  },
);
