// `track-wetness` (SP4.3a spec 5.1, plan Task 9; contract C3, C33, C41, C43, C44, C47): per completed leader lap and
// tyre type (slick, inter, wet) the field's common mode, the median residual of the cars in free air on that type
// against their dry reference, and a 1-state Kalman filter's wetness with its sd. A quick calculator (C31) recomputing
// at every completed lap; its scheduled run is its "as of" form at the current frame (spec 6.1).
//
// Rows (plan Task 9, R1–R5 and the unit's own):
//  - R1: on a generated race with rain from lap 30 (every lap 4 s slower) the state is within 2 sd of 4000 by lap 35;
//    on the same race dry it is not wet (below 0, or its 2 sd covering 0). Both sds are informative (under 1 s).
//  - R2: as of every leader crossing frame N, `trackWetnessAsOf(projectionAsOf(N))`, with `degradation`'s output of the
//    scheduled run at N, equals the scheduled run on the view at N.
//  - R3: after a flashback (a view at N whose delta rewinds from a later frame) the output equals a run that never
//    received the undone frames (C33).
//  - R4: the package registers it, so the generic guarded-view and behaviour-table tests run it (C41, C44).
//  - R5: the budget (`track-wetness.budget.test.ts`).
//  - The weather forecast moves only the prediction step: two views equal but for the forecast's rain % give equal
//    `byLap`.
//  - One tyre type only (every car on slicks): the slick common mode carries the state; the other types have none.
//  - No free-air car on a type: that type's common mode is `insufficientData` (C3).
//  - Outside the race phase the output is `notApplicable` (its `weekend-phase` row, C14, C44).
//
// Races come from the test-race generator (spec 6.4), each generated once per file in `beforeAll`, at the smallest size
// that shows its row (plan review P8).
import { unknown, type ForecastSample, type Known, type TyreType, type WeekendPhase } from '@pitwall/domain';
import { projectionAsOf, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS, trackWetnessAsOf, type TrackWetnessOutput } from '../../src/track-wetness/index.ts';
import { guardedQuick, NONE, PRACTICE, QUALIFYING } from '../situated.ts';
import { CALCULATORS, loadUnitFolders } from '../units.ts';
import { withAppendFrames } from './support.ts';

const calc = guardedQuick(trackWetnessCalculator);

/** An AI car of the probe field: σ 200 ms, ρ 0.3, 2 % mistakes, on mediums, no stop. */
const aiCar = (paceMs: number, over: Partial<GeneratorCar> = {}): GeneratorCar => ({
  paceMs,
  human: false,
  sigmaMs: 200,
  rho: 0.3,
  mistakeRate: 0.02,
  mistakeMedianMs: 1_500,
  mistakeSigmaLog: 0.6,
  wearFactor: 1,
  stops: [],
  startCompound: 'medium',
  ...over,
});

/** The defaults with this field (`cars` its length) and `over`. */
const params = (field: GeneratorCar[], over: Partial<GeneratorParams> = {}): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: field.length, field, ...over });

/** 8 AI cars 150 ms a lap apart, fastest on pole, over 38 laps: the field spreads into free air and nobody is lapped. */
const FIELD = Array.from({ length: 8 }, (_, i) => aiCar(90_000 + 150 * i));
const LAPS = 38;
const RAIN = { fromLap: 30, wetnessMs: 4_000 };

/** The race's view after `frame`, with `degradation`'s output of the scheduled run on it (the upstream output). */
const viewWithOutputs = (race: BuilderRace, frame: number, from?: number): EngineView => {
  const outputs = new Map([[DEGRADATION, degradationCalculator.compute(race.viewAt(frame))]]);
  return race.viewAt(frame, { outputs, ...(from !== undefined && { from }) });
};

/** The frame the leader starts lap 37 on: by then every car has completed lap 35. */
const byLap35 = (race: BuilderRace): number => race.framesOfLap(37)[0]!;

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** The common mode of `type` on leader lap `lap` of `out`. */
const commonMode = (out: TrackWetnessOutput, lap: number, type: TyreType): Known<number> => {
  const entry = out.byLap.find((l) => l.lap === lap);
  if (entry === undefined) throw new Error(`no byLap entry for lap ${lap}`);
  return entry.commonModeMs[type];
};

let wet: BuilderRace;
let dry: BuilderRace;
/** Car 1, on inters and faster, caught car 0 on lap 1 and is held 1 s behind it to the flag (no pass): never in free air. */
let heldInter: BuilderRace;
/** 6 cars over 12 laps, rain from lap 6, one stop: the as-of row's race. */
let small: BuilderRace;

beforeAll(() => {
  wet = generateRace(params(FIELD, { laps: LAPS, rain: RAIN }), 9).race;
  dry = generateRace(params(FIELD, { laps: LAPS }), 9).race;
  heldInter = generateRace(
    params([aiCar(90_000, { sigmaMs: 0, mistakeRate: 0 }), aiCar(84_000, { sigmaMs: 0, mistakeRate: 0, startCompound: 'inter' })], {
      laps: 12,
      pass: { ...GENERATOR_DEFAULTS.pass, hazardPerS: () => 0 },
    }),
    5,
  ).race;
  small = generateRace(
    params(
      Array.from({ length: 6 }, (_, i) => aiCar(90_000 + 150 * i, i === 2 ? { stops: [{ lap: 5, compound: 'hard' }] } : {})),
      { laps: 12, rain: { fromLap: 6, wetnessMs: 3_000 } },
    ),
    3,
  ).race;
});

describe('track-wetness (spec 5.1)', () => {
  it("R1: recovers the generator's parameters within its noise", () => {
    const rain = valueOf(calc.compute(viewWithOutputs(wet, byLap35(wet))).state);
    expect(rain.sdMs).toBeGreaterThan(0);
    expect(rain.sdMs).toBeLessThan(1_000);
    expect(Math.abs(rain.wetnessMs - RAIN.wetnessMs)).toBeLessThanOrEqual(2 * rain.sdMs);

    // the same field dry: not wet, below 0 or with its 2 sd covering 0
    const dryState = valueOf(calc.compute(viewWithOutputs(dry, byLap35(dry))).state);
    expect(dryState.sdMs).toBeGreaterThan(0);
    expect(dryState.sdMs).toBeLessThan(1_000);
    expect(dryState.wetnessMs - 2 * dryState.sdMs).toBeLessThan(0);
    expect(Math.abs(dryState.wetnessMs)).toBeLessThanOrEqual(2 * dryState.sdMs);
  });

  it('R2: as of frame N equals the scheduled run at every leader crossing frame', () => {
    const crossings = Array.from({ length: small.laps - 1 }, (_, i) => small.framesOfLap(i + 2)[0]!);
    const frames = [...crossings, small.lastFrame];
    const source = withAppendFrames(small, frames);
    for (const frame of frames) {
      const view = viewWithOutputs(small, frame);
      const cut = projectionAsOf(source, frame);
      const asOf: AsOfView = {
        history: cut.history,
        situation: cut.situation,
        frame,
        at: view.live.sessionTime,
        config: view.config,
        priors: view.priors,
        drivers: view.drivers,
        track: view.track,
        weekend: view.weekend,
        outputs: view.outputs,
      };
      expect(trackWetnessAsOf(asOf), `frame ${frame}`).toEqual(calc.compute(view));
    }
  });

  it('R3: rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    const target = wet.framesOfLap(33)[0]!;
    const undone = wet.framesOfLap(36)[0]!;
    // the view at the target whose delta rewinds from the later frame: the projection after the void
    const rewound = viewWithOutputs(wet, target, undone);
    expect(rewound.delta.rewound).toBeDefined();
    const fresh = calc.compute(viewWithOutputs(wet, target));
    expect(calc.compute(rewound)).toEqual(fresh);
    // and the undone laps did count before the flashback
    expect(calc.compute(viewWithOutputs(wet, undone))).not.toEqual(fresh);
  });

  it('R4: guarded view and behaviour-table completeness pick it up (C41, C44)', async () => {
    expect(CALCULATORS.find((c) => c.id === TRACK_WETNESS)).toBe(trackWetnessCalculator);
    expect(trackWetnessCalculator.kind).toBe('quick');
    expect(trackWetnessCalculator.cadence).toBe('lapCompleted');
    expect(trackWetnessCalculator.reads).toEqual(['laps', 'stints', 'miniSectors', 'session', 'spans:weekend-phase', 'spans:session-phase-race', { calculator: 'degradation' }]);
    const folder = (await loadUnitFolders()).find((f) => f.unit === TRACK_WETNESS);
    expect(Object.keys(folder?.table ?? {}).sort()).toEqual(['session-phase-race', 'weekend-phase']);
  });

  it('the weather forecast moves only the prediction step, never a measurement', () => {
    const view = viewWithOutputs(wet, byLap35(wet));
    const forecast = (rainPct: number): ForecastSample[] =>
      [0, 5, 10, 15].map((offsetMin) => ({ offsetMin, weather: 'lightRain', trackTempC: 28, trackTempTrend: 'flat', airTempC: 20, airTempTrend: 'flat', rainPct }));
    const withRain = (rainPct: number): EngineView => ({ ...view, live: { ...view.live, session: { ...view.live.session, forecast: forecast(rainPct) } } });
    const low = calc.compute(withRain(5));
    const high = calc.compute(withRain(95));
    expect(high.byLap).toEqual(low.byLap);
  });

  it('one tyre type only: the common mode carries the state', () => {
    const out = calc.compute(viewWithOutputs(wet, byLap35(wet)));
    // every car on slicks: no inter or wet common mode on any lap
    expect(out.byLap.length).toBeGreaterThanOrEqual(35);
    for (const entry of out.byLap) {
      expect(entry.commonModeMs.inter, `lap ${entry.lap}`).toEqual(unknown('insufficientData'));
      expect(entry.commonModeMs.wet, `lap ${entry.lap}`).toEqual(unknown('insufficientData'));
    }
    // the slick common mode: about 0 on the dry laps, about the rain's 4 s on the wet ones
    const slick = (laps: number[]): number[] => laps.map((n) => valueOf(commonMode(out, n, 'slick')));
    const dryLaps = Array.from({ length: 19 }, (_, i) => 10 + i);
    expect(Math.abs(mean(slick(dryLaps)))).toBeLessThanOrEqual(500);
    expect(Math.abs(mean(slick([31, 32, 33, 34, 35])) - RAIN.wetnessMs)).toBeLessThanOrEqual(1_000);
    // the state follows the slick common mode of the last laps
    const state = valueOf(out.state);
    expect(Math.abs(state.wetnessMs - mean(slick([33, 34, 35])))).toBeLessThanOrEqual(2 * state.sdMs);
  });

  it("no free-air car on a type: that type's commonModeMs is insufficientData", () => {
    const out = calc.compute(viewWithOutputs(heldInter, heldInter.lastFrame));
    const held = out.byLap.filter((l) => l.lap >= 2);
    expect(held.length).toBeGreaterThan(0);
    for (const entry of held) expect(entry.commonModeMs.inter, `lap ${entry.lap}`).toEqual(unknown('insufficientData'));
    // car 0 leads in free air on slicks
    expect(commonMode(out, 11, 'slick').known).toBe(true);
  });

  it('outside the race phase it is notApplicable (its weekend-phase row, C14)', () => {
    const view = viewWithOutputs(wet, byLap35(wet));
    /** The view with its weekend phase, and its open `weekend-phase` span, `phase`'s. */
    const inPhase = (phase: WeekendPhase): EngineView => {
      const { kind, ...detail } = phase;
      const spans = view.situation.byMachine['weekend-phase'] ?? [];
      return { ...view, situation: { weekendPhase: phase, byMachine: { ...view.situation.byMachine, 'weekend-phase': spans.map((s) => ({ ...s, kind, detail })) } } };
    };
    for (const phase of [PRACTICE, QUALIFYING, NONE]) {
      expect(calc.compute(inPhase(phase)), phase.kind).toEqual({ byLap: [], state: unknown('notApplicable') });
    }
  });
});
