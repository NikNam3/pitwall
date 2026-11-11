// Defaults of `forecast-field` (SP4.3a spec 6.1, 8).
import { defineConfig } from '@pitwall/engine/readers';

export const FORECAST_FIELD_CONFIG = defineConfig('forecast-field', {
  /** The "as of" build's lap fraction and gap may differ from the live build's by less than this (ms). Source: pitwall estimate (spec 6.1). */
  placementToleranceMs: 1500,
});
