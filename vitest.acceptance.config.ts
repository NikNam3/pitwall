import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // C84: a fresh, empty data dir per run.
    globalSetup: ['./vitest.global-setup.ts'],
    include: ['apps/bridge/test/acceptance/**/*.acceptance.test.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    // Files run in parallel: each replays whole recordings on one core; the gate's wall time is its slowest file.
    fileParallelism: true,
  },
});
