import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // Relative asset paths: the desktop app loads the build from file:// (apps/desktop/src/main.ts).
  base: './',
  // The bridge port a page uses without `?ws=` (shell/bridge-url.ts).
  define: { __PITWALL_WS_PORT__: JSON.stringify(process.env['PITWALL_WS_PORT'] ?? '4777') },
  server: { port: Number(process.env['PITWALL_UI_PORT'] ?? 5173) },
});
