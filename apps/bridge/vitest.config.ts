import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'bridge',
    testTimeout: 300_000, // fixture tests decode whole recordings: about a minute alone, much longer under `pnpm check`
    hookTimeout: 60_000,
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['**/*.acceptance.test.ts'],
  },
});
