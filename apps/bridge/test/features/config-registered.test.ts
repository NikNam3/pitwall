// Every unit config is declared by a feature (contract C47): a `defineConfig` key the analysis package exports and no
// feature registers could not be overridden by config.json and would be missing from the recording's config sidecar.
import { describe, expect, it } from 'vitest';
import * as analysis from '@pitwall/analysis';
import { effectiveConfig } from '../../src/feature-config.ts';
import { FEATURES } from '../../src/features/index.generated.ts';

/** The exported config keys: values with `key`, `defaults` and `read`, as `defineConfig` returns them. */
const exportedKeys = Object.values(analysis as Record<string, unknown>)
  .filter((v): v is { key: string; defaults: object; read: unknown } =>
    typeof v === 'object' && v !== null && 'key' in v && 'defaults' in v && typeof (v as { read?: unknown }).read === 'function')
  .map((v) => v.key);

describe('unit configs (C47)', () => {
  it('the analysis package exports config keys, rain-outlook and crossover among them', () => {
    expect(exportedKeys).toEqual(expect.arrayContaining(['rain-outlook', 'crossover', 'race-moment']));
  });
  it('every exported config key is registered by a feature, with its defaults in the effective config', () => {
    const effective = effectiveConfig(FEATURES);
    expect(exportedKeys.filter((key) => !(key in effective))).toEqual([]);
  });
});
