// `degradation`'s priors (spec 3.2, 4.1, C62a): the filter `fitStint` the aggregate runs over each source stint,
// `candidate`, `residual` and `lapUse`. Stored sources and set entries are built here and passed explicitly (C84).
import { carId, known, unknown, type LapUse } from '@pitwall/domain';
import type { PriorsCtx } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION_CONFIG, DEGRADATION_PRIORS, fitStint } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { carState } from '../../../../test-support/builders/index.ts';
import { guardedQuick, PRACTICE, situatedView } from '../situated.ts';
import { alternating, BASE_MS, pitStop, stintLaps, stintRecord, storedSource } from './support.ts';

const CTX: PriorsCtx = { config: {}, overrides: {} };
const entry = (key: string) => {
  const decl = DEGRADATION_PRIORS.entries[key];
  if (decl === undefined) throw new Error(`no entry ${key}`);
  return decl;
};

describe('degradation priors', () => {
  it('declares ν, its sd and the α offset for every compound', () => {
    for (const c of ['soft', 'medium', 'hard', 'inter', 'wet']) {
      for (const name of ['alphaOffsetMs', 'nuMsPerLap', 'nuSdMs']) expect(Object.keys(DEGRADATION_PRIORS.entries)).toContain(`degradation.${name}.${c}`);
    }
  });

  it('an aggregate over a one-lap stint is insufficientData', () => {
    const prior = { nuMsPerLap: 60, nuSdMs: 60 };
    expect(fitStint([{ lapNumber: 1, tyreAge: 0, ms: BASE_MS }], prior, DEGRADATION_CONFIG.defaults)).toEqual(unknown('insufficientData'));
    // a stint of several laps is a fit: its posterior mean and covariance
    const laps = Array.from({ length: 10 }, (_, i) => ({ lapNumber: i + 1, tyreAge: i, ms: BASE_MS + 80 * i }));
    const fit = fitStint(laps, prior, DEGRADATION_CONFIG.defaults);
    if (!fit.known) throw new Error(`unknown: ${fit.reason}`);
    expect(Math.abs(fit.value.nuMsPerLap - 80)).toBeLessThanOrEqual(8);
    expect(fit.value.cov[0][1]).toBeCloseTo(fit.value.cov[1][0], 9);
    expect(fit.value.cov[1][1]).toBeGreaterThan(0);
    // the aggregate over a practice source of one lap
    const one = storedSource(stintLaps({ from: 1, to: 1 }), { phase: PRACTICE });
    expect(entry('degradation.nuMsPerLap.soft').aggregate!([one], CTX)).toEqual(unknown('insufficientData'));
  });

  it('candidate and residual', () => {
    const { minSourceLaps } = DEGRADATION_CONFIG.defaults;
    const candidate = DEGRADATION_PRIORS.candidate!;
    // a race: lap 1 is no forPace lap, so laps 1..minSourceLaps hold minSourceLaps − 1 of them
    expect(candidate(storedSource(stintLaps({ from: 1, to: minSourceLaps })), CTX)).toBe(false);
    expect(candidate(storedSource(stintLaps({ from: 1, to: minSourceLaps + 1 })), CTX)).toBe(true);
    // an in lap is no forPace lap either
    expect(candidate(storedSource(stintLaps({ from: 1, to: minSourceLaps + 1, over: { [minSourceLaps + 1]: { inLap: true } } })), CTX)).toBe(false);
    // in practice lap 1 counts
    expect(candidate(storedSource(stintLaps({ from: 1, to: minSourceLaps }), { phase: PRACTICE }), CTX)).toBe(true);
    // the threshold is the config's
    expect(candidate(storedSource(stintLaps({ from: 1, to: 4 })), { config: { [DEGRADATION_CONFIG.key]: { minSourceLaps: 3 } }, overrides: {} })).toBe(true);

    // residual: the source's value minus the set's, in sd of the set's value
    const set = { 'degradation.nuMsPerLap.medium': known(60, 0), 'degradation.nuSdMs.medium': known(15, 0) };
    const source = { 'degradation.nuMsPerLap.medium': known(90, 0), 'degradation.nuSdMs.medium': known(20, 0) };
    const residual = entry('degradation.nuMsPerLap.medium').residual!(source, set);
    if (!residual.known) throw new Error(`unknown: ${residual.reason}`);
    expect(residual.value).toBeCloseTo(2, 9);
    expect(entry('degradation.nuMsPerLap.medium').residual!({ 'degradation.nuSdMs.medium': known(20, 0) }, set).known).toBe(false);
  });

  it('lapUse classifies a source`s laps as the calculator does', () => {
    // a race of car 0. Stint 1 (soft, laps 1..8): lap 1 the race's first, lap 4 invalid, lap 6 under the SC, lap 8 the in
    // lap. Stint 2 (medium, laps 9..15): lap 9 the out lap, lap 13 4 s slow.
    const first = stintLaps({
      from: 1,
      to: 8,
      noise: alternating(100),
      over: { 4: { valid: { lap: false, sectors: [true, false, true] } }, 6: { scShare: 1 }, 8: { inLap: true } },
    });
    const second = stintLaps({
      from: 9,
      to: 15,
      actual: 'C2',
      visual: 'medium',
      fuelAtFrom: 88,
      noise: (i) => alternating(100)(i) + (i === 4 ? 4_000 : 0),
      over: { 9: { outLap: true } },
    });
    const stop = pitStop({ lap: 8 });
    const stints = guardedQuick(degradationCalculator).compute(
      situatedView({
        cars: [carState({ tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 7 } })],
        history: { laps: [...first, ...second], stints: [stintRecord({ firstLap: 1, lastLap: 8 })], pitStops: [stop] },
      }),
    )[carId(0)]!;
    const usesOf = (laps: readonly { lapNumber: number; use: LapUse }[]) => Object.fromEntries(laps.map((l) => [l.lapNumber, l.use]));
    const lapUse = DEGRADATION_PRIORS.lapUse!;

    const one = lapUse(storedSource(first, { pitStops: [stop] }), CTX);
    expect(one).toEqual({
      1: { excluded: 'notForPace' },
      2: 'used',
      3: 'used',
      4: { excluded: 'notForPace' },
      5: 'used',
      6: { excluded: 'neutralised' },
      7: 'used',
      8: { excluded: 'inLap' },
    });
    expect(one).toEqual(usesOf(stints[0]!.laps));

    const two = lapUse(storedSource(second,{ pitStops: [stop] }), CTX);
    expect(two).toEqual({ 9: { excluded: 'outLap' }, 10: 'used', 11: 'used', 12: 'used', 13: 'downWeighted', 14: 'used', 15: 'used' });
    expect(two).toEqual(usesOf(stints[1]!.laps));
  });
});
