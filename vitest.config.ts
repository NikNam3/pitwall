import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    // C84: a fresh, empty data dir per run; runs once for every project.
    globalSetup: ['./vitest.global-setup.ts'],
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      {
        test: {
          name: 'root',
          // These tests drive real tools (ESLint with types, hook scripts, generators): seconds each, more under load.
          testTimeout: 30_000,
          include: ['test/**/*.test.ts', 'test-support/**/*.test.ts', 'scripts/**/*.test.ts'],
          exclude: ['**/*.budget.test.ts', '**/node_modules/**'],
        },
      },
    ],
  },
});
