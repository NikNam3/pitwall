import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'bridge',
    testTimeout: 60_000, // fixture tests decode whole recordings
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.acceptance.test.ts'],
  },
});
