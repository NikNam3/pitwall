import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import tseslint from 'typescript-eslint';
import uiStyle from './apps/ui/eslint/style-declarations.js';

const WINDOW_HOST = ['open', 'moveTo', 'resizeTo', 'screen'].map((property) => ({
  object: 'window',
  property,
  message: 'Host calls go through shell/host/.',
}));
const NUMBER_FORMAT = [
  ...['toFixed', 'toPrecision', 'toLocaleString'].map((property) => ({ property })),
  ...['NumberFormat', 'DateTimeFormat'].map((property) => ({ object: 'Intl', property })),
].map((entry) => ({ ...entry, message: 'Format numbers through kit/values/format.ts.' }));
const NETWORK = ['WebSocket', 'fetch'].map((name) => ({ name, message: 'Only connection/ talks to the network.' }));

/** The UI rules of spec 4.6 for `apps/ui/src`; a flag set to false exempts a folder from that rule. */
function uiRules({ network = true, host = true, format = true, colour = true } = {}) {
  return {
    'no-restricted-globals': network ? ['error', ...NETWORK] : 'off',
    'no-restricted-properties': ['error', ...(host ? WINDOW_HOST : []), ...(format ? NUMBER_FORMAT : [])],
    'pw-ui/no-colour-literals': colour ? 'error' : 'off',
  };
}
const UI_FILES = ['apps/ui/src/**/*.ts', 'apps/ui/src/**/*.svelte'];

const PURE_MESSAGE = 'Engine/strategy are pure: no clock, no environment, no I/O (spec 3.4).';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/',
      'external/',
      'recordings/',
      '**/.stryker-tmp/',
      '**/reports/',
      'apps/ui/dist/',
      'apps/ui/dist-e2e/',
      'apps/desktop/dist/',
      'apps/bridge/src/features/index.generated.ts',
      'packages/contracts/src/topics/index.generated.ts',
      '.claude/',
      '.superpowers/',
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
  // Electron's main and preload run on Node and Chromium globals; tsc checks names there.
  { files: ['apps/desktop/src/**/*.ts'], rules: { 'no-undef': 'off' } },
  ...svelte.configs['flat/recommended'].map((config) => ({ ...config, files: config.files ?? ['**/*.svelte'] })),
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: { 'no-undef': 'off' },
  },
  { files: UI_FILES, plugins: { 'pw-ui': uiStyle }, rules: uiRules() },
  { files: ['apps/ui/src/**/*.svelte'], rules: { 'pw-ui/style-declarations': ['error', { colours: true, fontFamily: true }] } },
  { files: ['apps/ui/src/theme/**'], rules: { ...uiRules({ colour: false }), 'pw-ui/style-declarations': ['error', { fontFamily: false }] } },
  { files: ['apps/ui/src/connection/**'], rules: uiRules({ network: false }) },
  { files: ['apps/ui/src/shell/host/**'], rules: uiRules({ host: false }) },
  { files: ['apps/ui/src/kit/values/format.ts'], rules: uiRules({ format: false }) },
  {
    files: ['apps/ui/src/widgets/**/*.svelte'],
    rules: { 'pw-ui/style-declarations': ['error', { colours: true, fontFamily: true, spacing: true }] },
  },
);
