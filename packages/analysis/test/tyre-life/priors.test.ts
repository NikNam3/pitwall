// `tyre-life`'s priors and config (spec 3.2, 4.2, C47, C62a). SP4.3c Task 12 (O1, spec §5.2 "Deletes"): its calibration
// wear entries (`tyreLife.wearPerLapPct.<compound>.<corner>`) and the age-loss limit (`tyreLife.ageLossLimitMs`) are
// deleted with the rate rule and the age basis they fed: the wear rate is `tyre-model`'s, its prior the game's (research
// 22 §2). Supervisor ruling (C43, one key per threshold): the limit is `tyre-model.limitPct` alone, so `tyre-life`'s
// `wearLimitPct` and its override `tyreLife.wearLimitPct` are deleted too (the user's 70 % hard limit is no per-set
// setting); with `minLaps` gone, tyre-life declares no config and no priors. The tests of their aggregate, residual and
// fallback went with them (C82: a test of a deleted mechanism is deleted with it; `fallback.test.ts` deleted).
import { describe, expect, it } from 'vitest';
import * as tyreLifeUnit from '../../src/tyre-life/index.ts';
import { TYRE_MODEL_CONFIG } from '../../src/tyre-model/index.ts';

describe('tyre-life priors and config', () => {
  it('declares no priors (no wear-rate entry, no age-loss limit, no wear limit) and no config', () => {
    const unit = tyreLifeUnit as unknown as Record<string, unknown>;
    expect(unit['TYRE_LIFE_PRIORS'], 'TYRE_LIFE_PRIORS').toBeUndefined();
    expect(unit['TYRE_LIFE_CONFIG'], 'TYRE_LIFE_CONFIG').toBeUndefined();
  });

  it('the one limit key is tyre-model`s limitPct, 70 %', () => {
    expect(TYRE_MODEL_CONFIG.defaults.limitPct).toBe(70);
  });
});
