import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/bridge/test/acceptance/**/*.acceptance.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
