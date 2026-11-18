// `degradation`'s priors (spec 3.2, 4.1, C62a): the filter `fitStint` the aggregate runs over each source stint,
// `candidate`, `residual` and `lapUse`. Stored sources and set entries are built here and passed explicitly (C84).
import { carId, known, unknown, type LapUse } from '@pitwall/domain';
import type { PriorsCtx } from '@pitwall/engine/readers';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEGRADATION_CONFIG, DEGRADATION_PRIORS, fitStint } from '../../src/degradation/index.ts';
import { DEGRADATION_COMPOUNDS } from '../../src/degradation/priors.ts';
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
    ).stints[carId(0)]!;
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

  // SP4.1a fx3b (ruling R37; C43, C62a): the calibration panel's N column is the unit's count of the sources its
  // aggregate pools per compound: those on the compound with a fit (at least two pace laps), the one rule `aggregate` uses.
  it('samples counts the sources (stops) the aggregate used', () => {
    const medium = { actual: 'C2', visual: 'medium' } as const;
    // two medium stints the filter fits, one medium stint of one lap it cannot fit (left out), one soft stint
    const fitA = storedSource(stintLaps({ from: 1, to: 10, ...medium, noise: alternating(100) }), { phase: PRACTICE });
    const fitB = storedSource(stintLaps({ car: 1, from: 1, to: 8, nu: 60, ...medium, noise: alternating(80) }), { phase: PRACTICE });
    const oneLap = storedSource(stintLaps({ car: 0, from: 12, to: 12, ...medium }), { phase: PRACTICE });
    const soft = storedSource(stintLaps({ from: 1, to: 9, visual: 'soft', noise: alternating(100) }), { phase: PRACTICE });
    const sources = [fitA, oneLap, fitB, soft];
    // the one-lap stint is left out of the aggregate: the pooled ν is the same without it
    expect(entry('degradation.nuMsPerLap.medium').aggregate!(sources, CTX)).toEqual(entry('degradation.nuMsPerLap.medium').aggregate!([fitA, fitB, soft], CTX));

    const expected = { soft: 1, medium: 2, hard: 0, inter: 0, wet: 0 } as const;
    for (const [compound, n] of Object.entries(expected)) {
      for (const name of ['alphaOffsetMs', 'nuMsPerLap', 'nuSdMs']) {
        const samples = entry(`degradation.${name}.${compound}`).samples;
        expect(samples, `degradation.${name}.${compound} declares samples`).toBeDefined();
        expect(samples!(sources, CTX), `degradation.${name}.${compound}`).toBe(n);
      }
    }
    // no source, no sample; a source the aggregate cannot fit is never counted
    expect(entry('degradation.nuMsPerLap.medium').samples!([], CTX)).toBe(0);
    expect(entry('degradation.nuMsPerLap.medium').samples!([oneLap], CTX)).toBe(0);
  });

  // SP4.3e Task 5 (C43, C62a; planner report 2026-11-17 §5 (a)): a compound's α offset is the pool of paired differences:
  // per (session, car) the compound's α minus that car's medium α in the same session. A driver's own pace cancels.
  describe('α offsets as paired differences', () => {
    const NU = DEGRADATION_CONFIG.defaults.defaultNuMsPerLap;
    const VISUAL_ACTUAL = { soft: 'C4', medium: 'C3', hard: 'C2' } as const;
    /** A 9-lap practice stint of `car` in `session` on `visual`, `paceMs` slower than the base; `alternating(amp)` noise. */
    const stint = (o: { car: number; session: string; visual: 'soft' | 'medium' | 'hard'; paceMs: number; from: number; amp?: number }) =>
      storedSource(
        stintLaps({ car: o.car, from: o.from, to: o.from + 8, nu: NU, actual: VISUAL_ACTUAL[o.visual], visual: o.visual, noise: (i) => o.paceMs + alternating(o.amp ?? 0)(i) }),
        { phase: PRACTICE, sessionUid: o.session, car: o.car },
      );
    const alpha = (compound: string, sources: Parameters<NonNullable<ReturnType<typeof entry>['aggregate']>>[0]) =>
      entry(`degradation.alphaOffsetMs.${compound}`).aggregate!(sources, CTX);
    const value = (k: ReturnType<typeof alpha>): number => {
      if (!k.known) throw new Error(`unknown: ${k.reason}`);
      return k.value;
    };

    it('two drivers 3 s apart: hard +1,500 and soft −300, independent of the second driver`s pace', () => {
      // driver A (car 0): medium, then hard 1,500 ms slower; driver B (car 1), 3,000 ms slower than A: medium, then soft 300 ms faster
      const a = [stint({ car: 0, session: '1', visual: 'medium', paceMs: 0, from: 1, amp: 60 }), stint({ car: 0, session: '1', visual: 'hard', paceMs: 1_500, from: 10, amp: 60 })];
      const b = (gapMs: number) => [
        stint({ car: 1, session: '1', visual: 'medium', paceMs: gapMs, from: 1, amp: 60 }),
        stint({ car: 1, session: '1', visual: 'soft', paceMs: gapMs - 300, from: 10, amp: 60 }),
      ];
      const sources = [...a, ...b(3_000)];
      expect(Math.abs(value(alpha('hard', sources)) - 1_500)).toBeLessThanOrEqual(30);
      expect(Math.abs(value(alpha('soft', sources)) - -300)).toBeLessThanOrEqual(30);
      expect(value(alpha('medium', sources))).toBe(0);
      // B's pace does not move the offsets
      for (const gapMs of [0, -2_000, 4_500]) {
        const other = [...a, ...b(gapMs)];
        expect(alpha('hard', other)).toEqual(alpha('hard', sources));
        expect(alpha('soft', other)).toEqual(alpha('soft', sources));
      }
      // the aggregate changed, so its version did (C62a: the priors store recomputes it)
      for (const c of DEGRADATION_COMPOUNDS) expect(entry(`degradation.alphaOffsetMs.${c}`).version).toBe(2);
    });

    it('a source with no medium pair gives no offset but still a ν', () => {
      const aMedium = stint({ car: 0, session: '1', visual: 'medium', paceMs: 0, from: 1 });
      const aHard = stint({ car: 0, session: '1', visual: 'hard', paceMs: 1_500, from: 10 });
      // car 2 drove hard only; car 0 drove hard in session 2 with its medium in session 1
      const lonelyHard = stint({ car: 2, session: '1', visual: 'hard', paceMs: 4_000, from: 1 });
      const otherSession = stint({ car: 0, session: '2', visual: 'hard', paceMs: -2_500, from: 1 });

      expect(alpha('hard', [aMedium, lonelyHard])).toEqual(unknown('insufficientData'));
      expect(alpha('hard', [aMedium, otherSession])).toEqual(unknown('insufficientData'));
      // unpaired sources leave the paired offset as it is
      expect(alpha('hard', [aMedium, aHard, lonelyHard, otherSession])).toEqual(alpha('hard', [aMedium, aHard]));
      expect(Math.abs(value(alpha('hard', [aMedium, aHard])) - 1_500)).toBeLessThanOrEqual(30);
      // they still give ν
      for (const unpaired of [lonelyHard, otherSession]) {
        const nu = entry('degradation.nuMsPerLap.hard').aggregate!([aMedium, unpaired], CTX);
        expect(Math.abs(value(nu) - NU)).toBeLessThanOrEqual(5);
        expect(entry('degradation.nuSdMs.hard').aggregate!([aMedium, unpaired], CTX).known).toBe(true);
      }
    });

    it('property: with one true offset per compound, any driver mix pools to it', () => {
      const compoundSet = fc.subarray(['soft', 'medium', 'hard'] as const, { minLength: 1 });
      const driver = fc.record({ paceMs: fc.integer({ min: -4_000, max: 4_000 }), session: fc.constantFrom('1', '2'), compounds: compoundSet });
      fc.assert(
        fc.property(fc.integer({ min: -2_000, max: 0 }), fc.integer({ min: 0, max: 3_000 }), fc.array(driver, { minLength: 1, maxLength: 5 }), (softMs, hardMs, drivers) => {
          const offset = { soft: softMs, medium: 0, hard: hardMs } as const;
          const sources = drivers.flatMap((d, car) =>
            d.compounds.map((visual, k) => stint({ car, session: d.session, visual, paceMs: d.paceMs + offset[visual], from: 1 + 9 * k })),
          );
          for (const compound of ['soft', 'hard'] as const) {
            const paired = drivers.some((d) => d.compounds.includes('medium') && d.compounds.includes(compound));
            const got = alpha(compound, sources);
            if (!paired) {
              expect(got).toEqual(unknown('insufficientData'));
              continue;
            }
            expect(Math.abs(value(got) - offset[compound]), `${compound}: ${JSON.stringify(got)}`).toBeLessThanOrEqual(5);
          }
        }),
        { numRuns: 60 },
      );
    });
  });
});
