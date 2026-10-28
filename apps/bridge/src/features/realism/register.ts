import { defineConfig } from '@pitwall/engine';
import { defineFeature } from '../feature.ts';

/**
 * Realism mode (spec 7.9): the config key the pipeline sets per session (from the UI between sessions) and keeps in the
 * session's sidecar. The engine does the masking; this feature only declares the key.
 */
export default defineFeature({
  name: 'realism',
  calculators: [],
  topics: [],
  config: [defineConfig('realism', { enabled: false })],
});
