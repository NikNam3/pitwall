import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineProject } from 'vitest/config';

export default defineProject({
  // The Svelte plugin compiles `.svelte.ts` rune modules.
  plugins: [svelte()],
  test: {
    name: 'ui',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
