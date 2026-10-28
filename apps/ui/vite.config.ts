import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  server: { port: Number(process.env['PITWALL_UI_PORT'] ?? 5173) },
});
