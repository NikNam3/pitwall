import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  // The Svelte plugin compiles `.svelte.ts` rune modules.
  // `svelteTesting` selects Svelte's client build and compiles the testing library's rune modules.
  plugins: [svelte(), svelteTesting()],
  test: {
    name: 'ui',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
