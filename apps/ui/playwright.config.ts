// Playwright (spec 9.3): fit, screenshots and cross-window end to end, all in Electron. Run through `pnpm test:ui`,
// which builds the UI (with the gallery) and the desktop app first.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '*.spec.ts',
  // Each spec starts its own Electron (and bridge); one at a time keeps ports, CPU and screenshots predictable.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  reporter: 'list',
  // Under the gitignored `reports/`.
  outputDir: './reports/playwright',
  // Flat: `e2e/__screenshots__/<name>.png`, the name given by the spec.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css' },
  },
});
