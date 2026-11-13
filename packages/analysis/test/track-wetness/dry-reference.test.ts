// `track-wetness` measured from dry (SP4.3b Task 19c; contract C3, C33, C39, C43, C62): research 19's wetness spike found
// the state taken against each stint's own first laps, so a race that starts wet reads as dry (Miami ≤ 0.9 s on a
// track at 17–26 s). The wetness is now measured against a dry reference per car: (a) its own dry slick laps this
// session, else (b) its dry laps in the weekend's earlier sessions (`view.weekend`, the car matched by team and race
// number, C62), else (c) the field's dry reference from the same sources. A lap on inters or wets is put on the slick
// scale through the lap model's inter/wet terms (forecast-field's config: `interOffsetMs`, `interMsPerWetnessMs`,
// `wetOffsetMs`, `wetMsPerWetnessMs`): w = (excess − offset) / slope. No dry reference at all: `insufficientData`, never 0.
//
// Rows (brief Task 19c):
//  1. a wet start (inters from lap 1) with a dry practice in the weekend reads against the practice's dry pace;
//  2. a wet start with no dry reference anywhere is `unknown('insufficientData')`;
//  3. rain mid-race on slicks reads against the dry laps before the rain (the existing behaviour, kept);
//  4. inter laps are put on the slick scale through the lap model's inter terms (a config override moves the state);
//  R1. rewind (C33) on row 1's race, with its weekend context.
//
// The generator adds its rain's `wetnessMs` to every compound alike. So that its inter laps follow the lap model, each
// race here sets the generator's inter offset to the medium's plus `interOffsetMs` (the lap model's inter offset
// against medium on a dry track): an inter lap's excess over the car's dry medium pace is then `interOffsetMs` + the
// rain's `wetnessMs`, i.e. a slick-scale wetness of `wetnessMs / interMsPerWetnessMs`. No car runs slicks in the rain
// of rows 1, 2 and 4, so the truth is one wetness on one scale.
import { carId, unknown, type Known, type OpenSpan, type Span } from '@pitwall/domain';
import type { EngineView, Projection, StoredSession, WeekendContext } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { FORECAST_FIELD_CONFIG } from '../../src/shared/forecast-field/config.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { guardedQuick, PRACTICE } from '../situated.ts';

const calc = guardedQuick(trackWetnessCalculator);
const LAP_MODEL = FORECAST_FIELD_CONFIG.defaults;

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

/** The generator's compounds with the inter on the lap model's scale: the medium's offset plus `interOffsetMs`. */
const COMPOUNDS: GeneratorParams['compounds'] = {
  ...GENERATOR_DEFAULTS.compounds,
  inter: { ...GENERATOR_DEFAULTS.compounds.inter, offsetMs: GENERATOR_DEFAULTS.compounds.medium.offsetMs + LAP_MODEL.interOffsetMs },
};

/** 8 AI cars 150 ms a lap apart, fastest on pole: the field spreads into free air and nobody is lapped. */
const field = (over: (i: number) => Partial<GeneratorCar> = () => ({})): GeneratorCar[] => Array.from({ length: 8 }, (_, i) => aiCar(90_000 + 150 * i, over(i)));

const params = (cars: GeneratorCar[], over: Partial<GeneratorParams>): GeneratorParams => ({ ...GENERATOR_DEFAULTS, compounds: COMPOUNDS, cars: cars.length, field: cars, ...over });

/** The generator's rain on every lap of the wet starts (ms on every compound alike): a slick-scale wetness of 12 s. */
const WET_START_RAIN_MS = 6_000;

/** The view after `frame`, with `degradation`'s output of the scheduled run on it, and the weekend context `weekend`. */
const viewOf = (race: BuilderRace, frame: number, o: { weekend?: WeekendContext; from?: number; config?: EngineView['config'] } = {}): EngineView => {
  const outputs = new Map([[DEGRADATION, degradationCalculator.compute(race.viewAt(frame))]]);
  const view = race.viewAt(frame, { outputs, ...(o.from !== undefined && { from: o.from }) });
  return { ...view, weekend: o.weekend, ...(o.config !== undefined && { config: { ...view.config, ...o.config } }) };
};

/** The frame the leader starts lap `n` on. */
const startOf = (race: BuilderRace, n: number): number => race.framesOfLap(n)[0]!;

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/**
 * `session`'s whole race as an earlier session of the weekend (C62): its final projection with a closed practice
 * `weekend-phase` span in place of the race's (every span of a stored session is closed), each slot carrying the car
 * key (team and race number) of the same slot of `race`, the race whose view reads it.
 */
function storedPractice(session: BuilderRace, race: BuilderRace, uid: string): StoredSession {
  const final = session.viewAt(session.lastFrame);
  const open = (final.situation.byMachine['weekend-phase'] ?? []) as readonly OpenSpan[];
  const { kind, ...detail } = PRACTICE;
  const practiceSpans: Span[] = open.map((s) => ({ ...s, kind, detail, end: final.live.sessionTime, endFrame: session.lastFrame + 1 }) as Span);
  const history = final.history as Projection;
  const projection: Projection = { ...history, spans: { ...history.spans, 'weekend-phase': practiceSpans } };
  const cars = race.viewAt(1).live.cars.map((c) => ({ carId: c.id, carKey: { teamId: c.identity.teamId, raceNumber: c.identity.raceNumber } }));
  return { sessionUid: uid, playerCar: carId(0), cars, projection };
}

/** The weekend context of `race` with `sessions` before it. */
function weekendOf(race: BuilderRace, sessions: StoredSession[]): WeekendContext {
  const player = race.viewAt(1).live.cars[0]!.identity;
  return { weekendId: 'w1', player: { teamId: player.teamId, raceNumber: player.raceNumber }, sessions };
}

/** A wet start: the field on inters from lap 1 in rain on every lap, no stop. */
let wetStart: BuilderRace;
/** The same field dry on mediums: the weekend's practice. */
let dryPractice: BuilderRace;
/** The same field on inters in the same rain: a wet practice, no dry lap in it. */
let wetPractice: BuilderRace;
/** Slicks throughout, rain from lap 20 (4 s on every lap). */
let midRace: BuilderRace;
/** Dry on mediums to lap 16, every car in on lap 16 for inters, rain from lap 17 (5 s on every compound). */
let toInters: BuilderRace;

beforeAll(() => {
  wetStart = generateRace(params(field(() => ({ startCompound: 'inter' })), { laps: 14, rain: { fromLap: 1, wetnessMs: WET_START_RAIN_MS } }), 9).race;
  dryPractice = generateRace(params(field(), { laps: 12 }), 11).race;
  wetPractice = generateRace(params(field(() => ({ startCompound: 'inter' })), { laps: 12, rain: { fromLap: 1, wetnessMs: WET_START_RAIN_MS } }), 13).race;
  midRace = generateRace(params(field(), { laps: 28, rain: { fromLap: 20, wetnessMs: 4_000 } }), 9).race;
  toInters = generateRace(params(field(() => ({ stops: [{ lap: 16, compound: 'inter' }] })), { laps: 26, rain: { fromLap: 17, wetnessMs: 5_000 } }), 9).race;
});

describe('track-wetness measured from a dry reference (Task 19c)', () => {
  it('a race that starts wet with a dry practice in the weekend reads the wetness against the practice\'s dry pace', () => {
    const weekend = weekendOf(wetStart, [storedPractice(dryPractice, wetStart, 'practice')]);
    const truth = WET_START_RAIN_MS / LAP_MODEL.interMsPerWetnessMs;
    const state = valueOf(calc.compute(viewOf(wetStart, startOf(wetStart, 12), { weekend })).state);
    // stint-relative it read about 0; against the practice it reads the 12 s the inters lose on the slick scale
    expect(Math.abs(state.wetnessMs - truth), `state ${state.wetnessMs} against ${truth}`).toBeLessThanOrEqual(1_500);
    expect(state.sdMs).toBeGreaterThan(0);
    expect(state.sdMs).toBeLessThan(1_500);
  });

  it("a race that starts wet with no dry reference anywhere gives unknown('insufficientData'), never 0", () => {
    const frame = startOf(wetStart, 12);
    // no weekend context at all
    expect(calc.compute(viewOf(wetStart, frame)).state).toEqual(unknown('insufficientData'));
    // a weekend whose earlier session is wet too: no dry lap in it either
    const weekend = weekendOf(wetStart, [storedPractice(wetPractice, wetStart, 'practice')]);
    expect(calc.compute(viewOf(wetStart, frame, { weekend })).state).toEqual(unknown('insufficientData'));
  });

  it('a race that turns wet mid-race reads the wetness against the dry laps before the rain', () => {
    const frame = startOf(midRace, 27);
    for (const weekend of [undefined, weekendOf(midRace, [storedPractice(dryPractice, midRace, 'practice')])]) {
      const state = valueOf(calc.compute(viewOf(midRace, frame, weekend === undefined ? {} : { weekend })).state);
      expect(state.sdMs).toBeGreaterThan(0);
      expect(state.sdMs).toBeLessThan(1_000);
      expect(Math.abs(state.wetnessMs - 4_000), `weekend ${weekend === undefined ? 'none' : 'dry practice'}: ${state.wetnessMs}`).toBeLessThanOrEqual(Math.max(2 * state.sdMs, 1_000));
    }
  });

  it("inter laps are put on the slick scale through the lap model's inter terms", () => {
    const frame = startOf(toInters, 25);
    // the inter stints start wet: stint-relative they read about 0; on the slick scale (5 s − 0) / 0.5 = 10 s
    const truth = 5_000 / LAP_MODEL.interMsPerWetnessMs;
    const state = valueOf(calc.compute(viewOf(toInters, frame)).state);
    expect(Math.abs(state.wetnessMs - truth), `state ${state.wetnessMs} against ${truth}`).toBeLessThanOrEqual(1_500);
    // the scale is the lap model's: a flatter inter slope reads the same laps as a wetter track
    const slope = LAP_MODEL.interMsPerWetnessMs / 2;
    const flatter = valueOf(calc.compute(viewOf(toInters, frame, { config: { [FORECAST_FIELD_CONFIG.key]: { interMsPerWetnessMs: slope } } })).state);
    expect(Math.abs(flatter.wetnessMs - 5_000 / slope), `state ${flatter.wetnessMs} against ${5_000 / slope}`).toBeLessThanOrEqual(2_500);
  });

  it('R1: rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    const weekend = weekendOf(wetStart, [storedPractice(dryPractice, wetStart, 'practice')]);
    const target = startOf(wetStart, 8);
    const undone = startOf(wetStart, 11);
    const rewound = viewOf(wetStart, target, { weekend, from: undone });
    expect(rewound.delta.rewound).toBeDefined();
    const fresh = calc.compute(viewOf(wetStart, target, { weekend }));
    expect(calc.compute(rewound)).toEqual(fresh);
    expect(fresh.state.known).toBe(true);
    // and the undone laps did count before the flashback
    expect(calc.compute(viewOf(wetStart, undone, { weekend }))).not.toEqual(fresh);
  });
});
