import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  // The bridge port a page uses without `?ws=` (shell/bridge-url.ts).
  define: { __PITWALL_WS_PORT__: JSON.stringify(process.env['PITWALL_WS_PORT'] ?? '4777') },
  server: { port: Number(process.env['PITWALL_UI_PORT'] ?? 5173) },
});
