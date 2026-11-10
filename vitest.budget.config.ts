import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // C84: a fresh, empty data dir per run.
    globalSetup: ['./vitest.global-setup.ts'],
    include: ['packages/*/test/**/*.budget.test.ts', 'apps/bridge/test/**/*.budget.test.ts'],
    // Speed targets measure time: one file at a time, after the parallel suite.
    fileParallelism: false,
  },
});
