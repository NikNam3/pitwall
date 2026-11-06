// `stint-analysis` (spec 5, 4.1, 4.4): `stintAnalysis.car`, our cars' stints with every lap's use from `degradation`,
// the fit line with its band per tyre age from `fitStint`'s posterior, and per compound the prior the stint started
// from with its source; a rival is `notApplicable`. Builder data; priors passed explicitly (C84). `degradation` runs for
// real on the same view and its output is the unit's input (`view.outputs`); both run through the guarded view (C41).
import { carId, unknown, type CarId, type FitPoint, type Known, type LapRecord, type StintAnalysis, type StintFit } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION, DEGRADATION_CONFIG, fitStint, type FilterPrior, type StintDegradation } from '../../src/degradation/index.ts';
import { stintAnalysisCalculator } from '../../src/stint-analysis/calculator.ts';
import { STINT_ANALYSIS, type StintAnalysisOutput } from '../../src/stint-analysis/index.ts';
import { carState, realismHidden } from '../../../../test-support/builders/index.ts';
import { alternating, pitStop, priorsSnapshot, stintLaps, stintRecord, viewPriors } from '../degradation/support.ts';
import { guardedQuick, situatedView } from '../situated.ts';

const degradation = guardedQuick(degradationCalculator);
const calc = guardedQuick(stintAnalysisCalculator);

const DEFAULT_PRIOR: FilterPrior = { nuMsPerLap: DEGRADATION_CONFIG.defaults.defaultNuMsPerLap, nuSdMs: DEGRADATION_CONFIG.defaults.defaultNuSdMs };

type ViewSpec = Parameters<typeof situatedView>[0] & { laps: LapRecord[]; teammate?: number };

/**
 * The view of a race (unless `phase` says otherwise) whose projection holds `laps` (and `stints`, `pitStops`), our car 0
 * (and `teammate`), with `degradation`'s output over that same view in `view.outputs`.
 */
function view(o: ViewSpec): EngineView {
  const { laps, history = {}, cars = [carState()], teammate, ...rest } = o;
  const withTeammate = (v: EngineView): EngineView => (teammate === undefined ? v : { ...v, live: { ...v.live, teammateCar: carId(teammate) } });
  const spec = { cars, history: { laps, ...history }, ...rest };
  const base = withTeammate(situatedView(spec));
  const outputs = new Map<string, unknown>([[DEGRADATION, degradation.compute(base)]]);
  return withTeammate(situatedView({ ...spec, outputs }));
}

/** `degradation`'s stints of car `car` in `v`. */
const degradationOf = (v: EngineView, car = 0): StintDegradation[] => {
  const out = (v.outputs.get(DEGRADATION) as Record<CarId, StintDegradation[]>)[carId(car)];
  if (out === undefined) throw new Error(`degradation has no stints for car ${car}`);
  return out;
};

/** The topic value of car `car`. */
const valueOf = (out: StintAnalysisOutput, car = 0): StintAnalysis => {
  const v = out[carId(car)];
  if (v === undefined) throw new Error(`no value for car ${car}`);
  return v;
};

/** The known content of car `car`'s value. */
const analysisOf = (out: StintAnalysisOutput, car = 0): { stints: StintFit[]; compounds: Extract<StintAnalysis, { known: true }>['value']['compounds'] } => {
  const v = valueOf(out, car);
  if (!v.known) throw new Error(`car ${car} is unknown: ${v.reason}`);
  return v.value;
};

const known_ = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/**
 * The fit line a stint should carry: `fitStint` over the laps the filter read (`used` and `downWeighted`; the corrected
 * time when the stint is fuel-corrected, else the lap time) from `prior`, one point per tyre age from the stint's first
 * lap's to its last lap's: `ms = α + ν · a`, `sdMs = sqrt(var α + a² · var ν + 2a · cov(α, ν))`.
 */
function expectedLine(stint: StintDegradation, prior: FilterPrior): FitPoint[] {
  const fitted = stint.laps
    .filter((l) => l.use === 'used' || l.use === 'downWeighted')
    .map((l) => ({ lapNumber: l.lapNumber, tyreAge: l.tyreAge, ms: stint.fuelCorrected ? known_(l.correctedMs) : l.lapTimeMs }));
  const fit = known_(fitStint(fitted, prior, DEGRADATION_CONFIG.defaults));
  const [[vaa, van], [, vnn]] = fit.cov;
  const first = stint.laps[0]!.tyreAge;
  const last = stint.laps.at(-1)!.tyreAge;
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const a = first + i;
    return { tyreAge: a, ms: Math.round(fit.alphaMs + fit.nuMsPerLap * a), sdMs: Math.round(Math.sqrt(vaa + a * a * vnn + 2 * a * van)) };
  });
}

/** `line` equals `expected` per tyre age, each `ms` and `sdMs` a whole number within 1 ms of the expected (rounding). */
function expectLine(line: Known<FitPoint[]>, expected: FitPoint[]): void {
  const points = known_(line);
  expect(points.map((p) => p.tyreAge)).toEqual(expected.map((p) => p.tyreAge));
  points.forEach((p, i) => {
    const e = expected[i]!;
    expect(Number.isInteger(p.ms)).toBe(true);
    expect(Number.isInteger(p.sdMs)).toBe(true);
    expect(Math.abs(p.ms - e.ms)).toBeLessThanOrEqual(1);
    expect(Math.abs(p.sdMs - e.sdMs)).toBeLessThanOrEqual(1);
  });
}

/**
 * The paths in `value` that JSON does not carry as they are: `undefined`, a non-finite number, a bigint, a function, a
 * symbol, or an object that is neither a plain object nor an array (a `Map`, a `Date`, a class instance).
 */
function nonJson(value: unknown, path = '$'): string[] {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return [];
  if (typeof value === 'number') return Number.isFinite(value) ? [] : [path];
  if (typeof value !== 'object') return [path];
  if (Array.isArray(value)) return value.flatMap((v, i) => nonJson(v, `${path}[${i}]`));
  if (Object.getPrototypeOf(value) !== Object.prototype) return [path];
  return Object.entries(value).flatMap(([k, v]) => nonJson(v, `${path}.${k}`));
}

/**
 * Our car's two stints of a race: soft laps 1..10 (lap 10 the in lap, ±100 ms noise, lap 6 4 s slow), the stop, medium
 * laps 11..16 (lap 11 the out lap).
 */
function twoStints(o: Omit<ViewSpec, 'laps'> = {}): EngineView {
  const first = stintLaps({ from: 1, to: 10, nu: 120, noise: (i) => alternating(100)(i) + (i === 5 ? 4_000 : 0), over: { 10: { inLap: true } } });
  const second = stintLaps({ from: 11, to: 16, nu: 70, actual: 'C2', visual: 'medium', fuelAtFrom: 85, over: { 11: { outLap: true } } });
  return view({
    laps: [...first, ...second],
    history: { stints: [stintRecord({ firstLap: 1, lastLap: 10 })], pitStops: [pitStop({ lap: 10 })] },
    cars: [carState({ tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 5 } })],
    ...o,
  });
}

describe('stint-analysis calculator', () => {
  it('is the quick unit `stint-analysis` per frame over `degradation` and our cars (C41, C42)', () => {
    expect(stintAnalysisCalculator.id).toBe(STINT_ANALYSIS);
    expect(stintAnalysisCalculator.kind).toBe('quick');
    expect(stintAnalysisCalculator.cadence).toBe('frame');
    // `degradation`'s output, and the identity area for `ourCars` (`playerCar`, `teammateCar`)
    expect(stintAnalysisCalculator.reads).toEqual(expect.arrayContaining([{ calculator: 'degradation' }, 'identity']));
  });

  it("our car's stints with every lap's use", () => {
    const v = twoStints();
    const deg = degradationOf(v);
    const { stints } = analysisOf(calc.compute(v));
    expect(stints.map((s) => [s.stint, s.firstLap, s.lastLap, s.actual, s.visual])).toEqual([
      [1, 1, 10, 'C3', 'soft'],
      [2, 11, 16, 'C2', 'medium'],
    ]);
    stints.forEach((s, i) => {
      const d = deg[i]!;
      // every lap of the stint as `degradation` used it: tyre age, lap time, corrected time and use
      expect(s.laps).toEqual(d.laps.map((l) => ({ lapNumber: l.lapNumber, tyreAge: l.tyreAge, lapTimeMs: l.lapTimeMs, correctedMs: l.correctedMs, use: l.use })));
      // the estimate as `degradation` made it (C43)
      expect([s.basePaceMs, s.nuMsPerLap, s.nuSdMs, s.basis, s.source]).toEqual([d.basePaceMs, d.nuMsPerLap, d.nuSdMs, d.basis, d.source]);
    });
    // the uses the scatter draws: used, down-weighted, excluded with its reason
    const uses = Object.fromEntries(stints[0]!.laps.map((l) => [l.lapNumber, l.use]));
    expect(uses[1]).toEqual({ excluded: 'notForPace' });
    expect(uses[2]).toBe('used');
    expect(uses[6]).toBe('downWeighted');
    expect(uses[10]).toEqual({ excluded: 'inLap' });
    expect(stints[1]!.laps.find((l) => l.lapNumber === 11)!.use).toEqual({ excluded: 'outLap' });
  });

  it('the fit line per tyre age of the stint: ms = α + ν · a, its band from fitStint`s posterior', () => {
    const v = twoStints();
    const deg = degradationOf(v);
    const { stints } = analysisOf(calc.compute(v));
    expectLine(stints[0]!.fitLine, expectedLine(deg[0]!, DEFAULT_PRIOR));
    expectLine(stints[1]!.fitLine, expectedLine(deg[1]!, DEFAULT_PRIOR));
    // the band widens away from the laps: at the stint's last tyre age it is wider than at its middle
    const line = known_(stints[0]!.fitLine);
    expect(line.at(-1)!.sdMs).toBeGreaterThan(line[Math.floor(line.length / 2)]!.sdMs);
  });

  it('the fit line starts from the calibration`s prior of the stint`s compound', () => {
    const snapshot = priorsSnapshot({ soft: { nuMsPerLap: 40, nuSdMs: 20 }, medium: { nuMsPerLap: 90, nuSdMs: 20 } });
    const v = twoStints({ priors: viewPriors(snapshot) });
    const deg = degradationOf(v);
    const { stints } = analysisOf(calc.compute(v));
    expectLine(stints[0]!.fitLine, expectedLine(deg[0]!, { nuMsPerLap: 40, nuSdMs: 20 }));
    expectLine(stints[1]!.fitLine, expectedLine(deg[1]!, { nuMsPerLap: 90, nuSdMs: 20 }));
  });

  it('a stint with fewer than two fitted laps has no fit line (insufficientData)', () => {
    // a race: lap 1 is no pace lap, lap 2 the stint's only one
    const { stints } = analysisOf(calc.compute(view({ laps: stintLaps({ from: 1, to: 2 }) })));
    expect(stints[0]!.fitLine).toEqual(unknown('insufficientData'));
  });

  it('per compound the prior and source: the calibration`s', () => {
    const snapshot = priorsSnapshot({ soft: { alphaOffsetMs: -300, nuMsPerLap: 40, nuSdMs: 20 }, medium: { alphaOffsetMs: 0, nuMsPerLap: 90, nuSdMs: 25 } });
    const { compounds } = analysisOf(calc.compute(twoStints({ priors: viewPriors(snapshot) })));
    expect(compounds).toEqual([
      expect.objectContaining({
        actual: 'C3',
        visual: 'soft',
        alphaOffsetMs: expect.objectContaining({ known: true, value: -300 }),
        nuMsPerLap: expect.objectContaining({ known: true, value: 40 }),
        nuSdMs: expect.objectContaining({ known: true, value: 20 }),
        source: expect.objectContaining({ kind: 'calibration', setName: 'Zandvoort long runs', sources: 3 }),
      }),
      expect.objectContaining({
        actual: 'C2',
        visual: 'medium',
        alphaOffsetMs: expect.objectContaining({ known: true, value: 0 }),
        nuMsPerLap: expect.objectContaining({ known: true, value: 90 }),
        nuSdMs: expect.objectContaining({ known: true, value: 25 }),
        source: expect.objectContaining({ kind: 'calibration', setName: 'Zandvoort long runs', sources: 3 }),
      }),
    ]);
  });

  it('per compound the prior and source: the config default without priors', () => {
    const { compounds } = analysisOf(calc.compute(twoStints()));
    expect(compounds.map((c) => c.visual)).toEqual(['soft', 'medium']);
    for (const c of compounds) {
      expect(c.nuMsPerLap).toMatchObject({ known: true, value: DEFAULT_PRIOR.nuMsPerLap });
      expect(c.nuSdMs).toMatchObject({ known: true, value: DEFAULT_PRIOR.nuSdMs });
      expect(c.source.kind).toBe('default');
      // no calibration and no track file: no α offset
      expect(c.alphaOffsetMs.known).toBe(false);
    }
  });

  it('per compound the prior a stint started from, not the stint`s estimate: a long stint turns session, its prior stays calibration', () => {
    // soft prior ν 60 sd 60; pace laps 2..21: the session's share of ν passes half (degradation's test)
    const snapshot = priorsSnapshot({ soft: { nuMsPerLap: 60, nuSdMs: 60 } });
    const v = view({ laps: stintLaps({ from: 1, to: 21, nu: 80, noise: alternating(100) }), priors: viewPriors(snapshot) });
    const { stints, compounds } = analysisOf(calc.compute(v));
    expect(stints[0]!.source.kind).toBe('session');
    expect(compounds).toHaveLength(1);
    expect(compounds[0]!.visual).toBe('soft');
    expect(compounds[0]!.nuMsPerLap).toMatchObject({ known: true, value: 60 });
    expect(compounds[0]!.source).toMatchObject({ kind: 'calibration', setName: 'Zandvoort long runs' });
  });

  it('per compound one entry: two stints on one compound share it', () => {
    // soft 1..8, the stop, soft 9..16 from new
    const first = stintLaps({ from: 1, to: 8, over: { 8: { inLap: true } } });
    const second = stintLaps({ from: 9, to: 16, fuelAtFrom: 88, over: { 9: { outLap: true } } });
    const v = view({ laps: [...first, ...second], history: { stints: [stintRecord({ firstLap: 1, lastLap: 8 })], pitStops: [pitStop({ lap: 8 })] } });
    const { stints, compounds } = analysisOf(calc.compute(v));
    expect(stints.map((s) => s.visual)).toEqual(['soft', 'soft']);
    expect(compounds.map((c) => [c.actual, c.visual])).toEqual([['C3', 'soft']]);
  });

  it('fuelCorrected carried: a stint fitted on its lap times has its fit line on them', () => {
    // our car's fuel restricted on every lap: `degradation` fits the lap times uncorrected (R17)
    const laps = stintLaps({ from: 1, to: 10, noise: alternating(100) }).map((l) => ({ ...l, fuelAtStartKg: unknown('restricted'), fuelAtEndKg: unknown('restricted') }));
    const v = view({ laps });
    const deg = degradationOf(v)[0]!;
    expect(deg.fuelCorrected).toBe(false);
    const { stints } = analysisOf(calc.compute(v));
    expect(stints[0]!.fuelCorrected).toBe(false);
    expectLine(stints[0]!.fitLine, expectedLine(deg, DEFAULT_PRIOR));
    // a corrected stint carries `true`
    expect(analysisOf(calc.compute(view({ laps: stintLaps({ from: 1, to: 10 }) }))).stints[0]!.fuelCorrected).toBe(true);
  });

  it('our cars: the teammate`s stints too', () => {
    const laps = [...stintLaps({ from: 1, to: 8 }), ...stintLaps({ car: 1, from: 1, to: 8, nu: 100 })];
    const out = calc.compute(view({ laps, cars: [carState(), carState({ id: carId(1) })], teammate: 1 }));
    expect(analysisOf(out, 0).stints.map((s) => s.stint)).toEqual([1]);
    expect(analysisOf(out, 1).stints.map((s) => [s.stint, s.firstLap, s.lastLap])).toEqual([[1, 1, 8]]);
  });

  it('a rival is notApplicable', () => {
    const laps = [...stintLaps({ from: 1, to: 8 }), ...stintLaps({ car: 3, from: 1, to: 8, hidden: true })];
    const v = view({ laps, cars: [carState(), realismHidden(carState({ id: carId(3) }))] });
    // `degradation` has the rival's stints; the topic does not show them
    expect(degradationOf(v, 3)).toHaveLength(1);
    const out = calc.compute(v);
    expect(valueOf(out, 3)).toEqual(unknown('notApplicable'));
    expect(valueOf(out, 0).known).toBe(true);
  });

  it('the topic value is JSON-safe', () => {
    const snapshot = priorsSnapshot({ soft: { alphaOffsetMs: -300, nuMsPerLap: 40, nuSdMs: 20 } });
    const laps = [...stintLaps({ from: 1, to: 10, over: { 10: { inLap: true } } }), ...stintLaps({ from: 11, to: 16, actual: 'C2', visual: 'medium', fuelAtFrom: 85, over: { 11: { outLap: true } } })];
    const rival = stintLaps({ car: 3, from: 1, to: 8, hidden: true });
    const v = view({
      laps: [...laps, ...rival],
      history: { stints: [stintRecord({ firstLap: 1, lastLap: 10 })], pitStops: [pitStop({ lap: 10 })] },
      cars: [carState({ tyres: { actualCompound: 'C2', visualCompound: 'medium', age: 5 } }), realismHidden(carState({ id: carId(3) }))],
      priors: viewPriors(snapshot),
    });
    const out = calc.compute(v);
    for (const car of [0, 3]) {
      const value = valueOf(out, car);
      expect(nonJson(value)).toEqual([]);
      expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    }
  });
});
