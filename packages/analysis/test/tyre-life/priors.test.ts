// `tyre-life`'s priors (spec 3.2, 4.2, C62a). SP4.3c Task 12 (O1, spec §5.2 "Deletes"): its calibration wear entries
// (`tyreLife.wearPerLapPct.<compound>.<corner>`) and the age-loss limit (`tyreLife.ageLossLimitMs`) are deleted with the
// rate rule and the age basis they fed: the wear rate is `tyre-model`'s, its prior the game's (research 22 §2). The
// tests of their aggregate and residual went with them (C82: a test of a deleted mechanism is deleted with it).
import { describe, expect, it } from 'vitest';
import { TYRE_LIFE_PRIORS } from '../../src/tyre-life/index.ts';

describe('tyre-life priors', () => {
  it('declares no wear-rate entry and no age-loss limit any more', () => {
    const keys = Object.keys(TYRE_LIFE_PRIORS.entries);
    expect(keys.filter((k) => k.startsWith('tyreLife.wearPerLapPct.'))).toEqual([]);
    expect(keys).not.toContain('tyreLife.ageLossLimitMs');
  });

  it('every entry left is override-only (no aggregate)', () => {
    for (const [key, decl] of Object.entries(TYRE_LIFE_PRIORS.entries)) expect(decl.aggregate, key).toBeUndefined();
  });
});
