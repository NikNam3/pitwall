// The `tyre-model` and `tyre-life` features (SP4.3c Task 12, spec §5.2; C42, C47, C62a, C62c, C63). `tyre-model` is a
// calculator (no topic, C42) with its config sections (the unit's and one per tyre type) and its driver-profile entries
// (`tyreModel.wearFactor.<compound>`, replacing `driverNoise.wearRatePct.*`); `tyre-life` declares no config and no
// priors any more (its wear entries, age-loss limit and wear limit deleted; the limit is `tyre-model.limitPct`).
import { describe, expect, it } from 'vitest';
import driverNoise from '../../../src/features/driver-noise/register.ts';
import tyreLife from '../../../src/features/tyre-life/register.ts';
import tyreModel from '../../../src/features/tyre-model/register.ts';

const keysOf = (decls: readonly { key: string }[] | undefined): string[] => (decls ?? []).map((d) => d.key);
const entriesOf = (decls: readonly { entries: Record<string, unknown> }[] | undefined): string[] => (decls ?? []).flatMap((d) => Object.keys(d.entries));

describe('tyre-model feature', () => {
  it('registers the calculators tyre-model and tyre-model-fit (SP4.3c Task 12s, ruling R53), no topic', () => {
    expect(tyreModel.name).toBe('tyre-model');
    expect(tyreModel.calculators.map((c) => c.id).sort()).toEqual(['tyre-model', 'tyre-model-fit']);
    expect(tyreModel.topics).toEqual([]);
  });

  it('registers its config sections: the unit`s and one per tyre type', () => {
    expect(keysOf(tyreModel.config).sort()).toEqual(['tyre-model', 'tyre-model.inter', 'tyre-model.slick', 'tyre-model.wet']);
  });

  it('declares the driver-profile entries tyreModel.wearFactor.<compound>; driver-noise declares no wear entry', () => {
    const entries = entriesOf(tyreModel.profiles as readonly { entries: Record<string, unknown> }[] | undefined);
    for (const c of ['soft', 'medium', 'hard']) expect(entries, c).toContain(`tyreModel.wearFactor.${c}`);
    expect(entriesOf(driverNoise.profiles as readonly { entries: Record<string, unknown> }[] | undefined).filter((k) => k.startsWith('driverNoise.wearRatePct.'))).toEqual([]);
  });
});

describe('tyre-life feature', () => {
  it('registers its calculator with no config and no priors (its wear entries and limits deleted, C43)', () => {
    expect(tyreLife.calculators.map((c) => c.id)).toEqual(['tyre-life']);
    expect(tyreLife.config ?? []).toEqual([]);
    expect(tyreLife.priors ?? []).toEqual([]);
  });
});
