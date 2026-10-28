import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'engine',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.acceptance.test.ts'],
    // Stryker's coverage instrumentation slows the session-runner property tests past the 5 s default.
    testTimeout: 30_000,
  },
});
