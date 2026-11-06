// `degradation` (spec 4.1, 4.4): a Kalman filter per car and stint over the fuel-corrected `forPace` laps, starting from
// the calibration's prior for the stint's compound or the config default. Builder data; priors passed explicitly (C84);
// every case runs through the guarded view (C41).
import { carId, carStatusSpans, type Known, type LapRecord } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, DEGRADATION_BEHAVIOUR, DEGRADATION_CONFIG, type StintDegradation } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { carState, realismHidden } from '../../../../test-support/builders/index.ts';
import { guardedQuick, PRACTICE, situatedView } from '../situated.ts';
import { CALCULATORS } from '../units.ts';
import { alternating, fuelAt, GAMMA, pitStop, priorsSnapshot, stintLaps, stintRecord, viewPriors } from './support.ts';

const calc = guardedQuick(degradationCalculator);

/** Our car (0) on its current set, the projection holding `laps` (and `stints`, `pitStops`); a race unless `phase` says otherwise. */
const view = (o: Parameters<typeof situatedView>[0] & { laps: LapRecord[] }): EngineView => {
  const { laps, history = {}, cars = [carState()], ...rest } = o;
  return situatedView({ cars, history: { laps, ...history }, ...rest });
};

/** The stints of car `car`, oldest first. */
const stintsOf = (v: EngineView, car = 0): StintDegradation[] => {
  const stints = calc.compute(v)[carId(car)];
  if (stints === undefined) throw new Error(`no stints for car ${car}`);
  return stints;
};

const valueOf = (k: Known<number>): number => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/** Lap `n`'s use in the stint. */
const useOf = (stint: StintDegradation, n: number) => stint.laps.find((l) => l.lapNumber === n)?.use;

describe('degradation calculator', () => {
  it('is the quick calculator `degradation` per frame over laps, stints, pit stops, tyres, decisions and car-status', () => {
    expect(degradationCalculator.id).toBe(DEGRADATION);
    expect(degradationCalculator.kind).toBe('quick');
    expect(degradationCalculator.cadence).toBe('frame');
    expect(degradationCalculator.reads).toEqual(expect.arrayContaining(['laps', 'stints', 'pitStops', 'tyres', 'decisions', 'spans:car-status']));
  });

  it('a constant-degradation stint recovers ν within 10 %', () => {
    // a race: lap 1 is no pace lap; laps 2..16 are 15 laps at tyre age 1..15 with ν 80 ms/lap and a noise of ±150 ms
    // that alternates symmetrically over them (uncorrelated with the age)
    const noise = (i: number) => (i === 0 ? 0 : alternating(150)(i - 1));
    const [stint] = stintsOf(view({ laps: stintLaps({ from: 1, to: 16, nu: 80, noise }) }));
    expect(stint!.stint).toBe(1);
    expect(Math.abs(valueOf(stint!.nuMsPerLap) - 80)).toBeLessThanOrEqual(8);
  });

  it('a slow outlier is down-weighted, a fast lap never', () => {
    // pace laps 2..13 (tyre age 1..12), ±100 ms noise; lap 8 (age 7, near the stint's middle) 4 s slow or 4 s fast
    const spec = { from: 1, to: 13, nu: 80, noise: alternating(100) };
    const clean = stintsOf(view({ laps: stintLaps(spec) }))[0]!;
    const slow = stintsOf(view({ laps: stintLaps({ ...spec, noise: (i) => alternating(100)(i) + (i === 7 ? 4_000 : 0) }) }))[0]!;
    const fast = stintsOf(view({ laps: stintLaps({ ...spec, noise: (i) => alternating(100)(i) - (i === 7 ? 4_000 : 0) }) }))[0]!;
    expect(useOf(clean, 8)).toBe('used');
    expect(useOf(slow, 8)).toBe('downWeighted');
    expect(useOf(fast, 8)).toBe('used');
    expect(Math.abs(valueOf(slow.nuMsPerLap) - valueOf(clean.nuMsPerLap))).toBeLessThan(5);
  });

  it('fuel correction uses γ', () => {
    // the same stint on 100 kg and on 60 kg at its start: the lap times differ by γ · 40 kg, the corrected times do not
    const heavy = stintLaps({ from: 1, to: 10, fuelAtFrom: 100 });
    const light = stintLaps({ from: 1, to: 10, fuelAtFrom: 60 });
    const a = stintsOf(view({ laps: heavy }))[0]!;
    const b = stintsOf(view({ laps: light }))[0]!;
    expect(a.fuelCorrected).toBe(true);
    expect(b.fuelCorrected).toBe(true);
    expect(a.basePaceMs.known).toBe(true);
    expect(a.basePaceMs).toEqual(b.basePaceMs);
    // per lap: the lap time minus γ · fuel at the lap's start (spec 4.1)
    for (const l of a.laps) {
      const record = heavy.find((r) => r.lapNumber === l.lapNumber)!;
      expect(l.lapTimeMs).toBe(record.lapTimeMs);
      expect(l.correctedMs).toMatchObject({ known: true, value: record.lapTimeMs - GAMMA * fuelAt({ from: 1, fuelAtFrom: 100 }, l.lapNumber) });
    }
    // γ is the config's
    const g40 = stintsOf(view({ laps: heavy, config: { [DEGRADATION_CONFIG.key]: { gammaMsPerKg: 40 } } }))[0]!;
    expect(g40.laps.find((l) => l.lapNumber === 5)!.correctedMs).toMatchObject({
      known: true,
      value: heavy[4]!.lapTimeMs - 40 * fuelAt({ from: 1, fuelAtFrom: 100 }, 5),
    });
  });

  it('a new stint starts from the prior of its compound', () => {
    // stint 1: soft, laps 1..10 at ν 150 (lap 10 the in lap); the stop; stint 2: medium from new, lap 11 the out lap,
    // lap 12 its first pace lap. The calibration holds soft ν 40 and medium ν 90, each sd 20.
    const first = stintLaps({ from: 1, to: 10, nu: 150, over: { 10: { inLap: true } } });
    const second = stintLaps({ from: 11, to: 12, actual: 'C2', visual: 'medium', fuelAtFrom: 85, over: { 11: { outLap: true } } });
    const snapshot = priorsSnapshot({ soft: { nuMsPerLap: 40, nuSdMs: 20 }, medium: { nuMsPerLap: 90, nuSdMs: 20 } });
    const stints = stintsOf(
      view({
        laps: [...first, ...second],
        history: { stints: [stintRecord({ firstLap: 1, lastLap: 10 })], pitStops: [pitStop({ lap: 10 })] },
        cars: [carState({ tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 2 } })],
        priors: viewPriors(snapshot),
      }),
    );
    expect(stints.map((s) => [s.stint, s.actual, s.visual])).toEqual([
      [1, 'C3', 'soft'],
      [2, 'C2', 'medium'],
    ]);
    const s2 = stints[1]!;
    expect(useOf(s2, 11)).toEqual({ excluded: 'outLap' });
    expect(useOf(s2, 12)).toBe('used');
    expect(Math.abs(valueOf(s2.nuMsPerLap) - 90)).toBeLessThan(1);
    expect(Math.abs(valueOf(s2.nuSdMs) - 20)).toBeLessThanOrEqual(2);
    expect(s2.source).toMatchObject({ kind: 'calibration', setName: 'Zandvoort long runs', sources: 3 });
    expect(s2.source.sessionShare).toBeGreaterThanOrEqual(0);
    expect(s2.source.sessionShare).toBeLessThanOrEqual(0.05);
  });

  it('the session share grows with laps; the source turns session past half (spec 4.4)', () => {
    // soft prior ν 60 sd 60; pace laps 2..21 at ν 80, ±100 ms noise. The share is `1 − posteriorVar / priorVar` of ν.
    const laps = stintLaps({ from: 1, to: 21, nu: 80, noise: alternating(100) });
    const priors = viewPriors(priorsSnapshot({ soft: { nuMsPerLap: 60, nuSdMs: 60 } }));
    const stints = Array.from({ length: 20 }, (_, k) => stintsOf(view({ laps: laps.slice(0, k + 2), priors }))[0]!);
    const shares = stints.map((s) => s.source.sessionShare);
    for (let i = 1; i < shares.length; i++) expect(shares[i]!).toBeGreaterThanOrEqual(shares[i - 1]! - 1e-9);
    for (const s of stints) {
      const sd = valueOf(s.nuSdMs);
      expect(s.source.sessionShare).toBeCloseTo(Math.max(0, 1 - (sd * sd) / (60 * 60)), 6);
      expect(s.source.kind).toBe(s.source.sessionShare > 0.5 ? 'session' : 'calibration');
    }
    expect(shares[0]!).toBeLessThanOrEqual(0.5);
    expect(shares.at(-1)!).toBeGreaterThan(0.5);
  });

  it('without priors and without a track file: config default, source default', () => {
    // view.priors and view.track are notApplicable (the view's defaults); lap 2 is the stint's only pace lap
    const laps = stintLaps({ from: 1, to: 2 });
    const s = stintsOf(view({ laps }))[0]!;
    expect(Math.abs(valueOf(s.nuMsPerLap) - DEGRADATION_CONFIG.defaults.defaultNuMsPerLap)).toBeLessThan(1);
    expect(Math.abs(valueOf(s.nuSdMs) - DEGRADATION_CONFIG.defaults.defaultNuSdMs)).toBeLessThanOrEqual(6);
    expect(s.source.kind).toBe('default');
    // the default is the config's
    const o = stintsOf(view({ laps, config: { [DEGRADATION_CONFIG.key]: { defaultNuMsPerLap: 70, defaultNuSdMs: 30 } } }))[0]!;
    expect(Math.abs(valueOf(o.nuMsPerLap) - 70)).toBeLessThan(1);
    expect(Math.abs(valueOf(o.nuSdMs) - 30)).toBeLessThanOrEqual(3);
    expect(o.source.kind).toBe('default');
  });

  it('a rival under realism: basis age; in the race our car`s fuel at the same lap; in practice not fuel-corrected', () => {
    // our car 0 with its fuel and wear visible; rival 1 with both hidden (`unknown('realism')`), on its own true load
    const oursSpec = { from: 1, to: 6, fuelAtFrom: 100 };
    const ours = stintLaps(oursSpec);
    const rival = stintLaps({ car: 1, from: 1, to: 6, fuelAtFrom: 94, hidden: true });
    const cars = [carState(), realismHidden(carState({ id: carId(1) }))];
    const race = view({ laps: [...ours, ...rival], cars });
    const r = stintsOf(race, 1)[0]!;
    expect(r.basis).toBe('age');
    expect(r.fuelCorrected).toBe(true);
    for (const n of [2, 3, 4, 5, 6]) {
      const record = rival.find((l) => l.lapNumber === n)!;
      expect(r.laps.find((l) => l.lapNumber === n)!.correctedMs).toMatchObject({ known: true, value: record.lapTimeMs - GAMMA * fuelAt(oursSpec, n) });
    }
    expect(stintsOf(race, 0)[0]!.basis).toBe('wear');

    const practice = view({ laps: [...ours, ...rival], cars, phase: PRACTICE });
    expect(stintsOf(practice, 1)[0]!.fuelCorrected).toBe(false);
    expect(stintsOf(practice, 1)[0]!.basis).toBe('age');
    expect(stintsOf(practice, 0)[0]!.fuelCorrected).toBe(true);
  });

  it('a rival under realism past our car`s last lap: our last fuel minus our burn per lap since (spec 4.1)', () => {
    // our car has laps 1..4 (fuel 100, 98.5, 97, 95.5 kg at their starts, 1.5 kg a lap); the rival is on lap 6
    const oursSpec = { from: 1, to: 4, fuelAtFrom: 100 };
    const rival = stintLaps({ car: 1, from: 1, to: 6, fuelAtFrom: 94, hidden: true });
    const cars = [carState(), realismHidden(carState({ id: carId(1) }))];
    const r = stintsOf(view({ laps: [...stintLaps(oursSpec), ...rival], cars }), 1)[0]!;
    // lap 6: 95.5 − 2 × 1.5 = 92.5 kg
    expect(r.laps.find((l) => l.lapNumber === 6)!.correctedMs).toMatchObject({ known: true, value: rival[5]!.lapTimeMs - GAMMA * 92.5 });
  });

  it('the behaviour table covers every car-status kind (C44)', () => {
    expect(Object.keys(DEGRADATION_BEHAVIOUR)).toEqual(['car-status']);
    expect(Object.keys(DEGRADATION_BEHAVIOUR['car-status']!).sort()).toEqual([...carStatusSpans.kinds].sort());
    // the generic completeness tests (behaviour-completeness, guarded-view-completeness) see the calculator
    expect(CALCULATORS.map((c) => c.id)).toContain(DEGRADATION);
  });
});
