import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
      {
        test: {
          name: 'root',
          include: ['test/**/*.test.ts', 'test-support/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
    ],
  },
});
