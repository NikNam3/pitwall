// `forecast-field`'s config (SP4.3a final review F1; C47): `forecast-field` is no unit, so the feature of the unit that
// builds the starting point, `forecast-score`, declares its config section. Then the section is in the effective config
// (and so in every recording's config sidecar), and `<data dir>/config.json` overrides it like any declared key.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FORECAST_FIELD_CONFIG } from '../../../../../packages/analysis/src/shared/forecast-field/config.ts';
import { effectiveConfig, loadFeatureConfig } from '../../../src/feature-config.ts';
import { FEATURES } from '../../../src/features/index.generated.ts';

const KEY = FORECAST_FIELD_CONFIG.key;

describe('forecast-field config (F1, C47)', () => {
  it("forecast-score's feature declares the forecast-field section", () => {
    const feature = FEATURES.find((f) => f.name === 'forecast-score');
    expect(feature?.config?.map((c) => c.key)).toContain(KEY);
  });

  it('the effective config holds every forecast-field default (what the config sidecar keeps)', () => {
    expect(effectiveConfig(FEATURES)[KEY]).toEqual(FORECAST_FIELD_CONFIG.defaults);
  });

  it('config.json overrides a forecast-field value; the other fields keep their defaults', () => {
    const root = mkdtempSync(join(tmpdir(), 'pitwall-forecast-field-config-'));
    writeFileSync(join(root, 'config.json'), JSON.stringify({ [KEY]: { scPaceFactor: 1.7 } }));
    const config = loadFeatureConfig(root, FEATURES);
    expect(config[KEY]).toEqual({ ...FORECAST_FIELD_CONFIG.defaults, scPaceFactor: 1.7 });
  });
});
