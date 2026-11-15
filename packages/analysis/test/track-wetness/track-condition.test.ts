// `track-wetness` owns the track condition (SP4.3c Task 14, O3; C3, C43, C62a): the one wet rule (`wet`), the dry
// reference (`dryRefMs` with `dryRefSource`) and, while no slick lap exists, the game's slick delta as a wetness reading
// (research 22 §1.9: a reading, never a second dry reference).
//
// Rows (plan Task 14):
//  4. `wet` is `wetnessMs − wetSigmas · sdMs > 0`, the one rule: a state of +200 ± 400 ms (any positive wetness within
//     wetSigmas sd) is not wet; the lap model and the race forecast read it (`../lap-model`, `../race-forecast`).
//  5. a dry reference without a slick lap: from the calibration set's priors entry `trackWetness.dryRefMs`; without one,
//     the slick delta gives a wetness reading and `dryRefMs` is `insufficientData`.
//
// How these tests read the unit (the test agent's decisions, Task 14 report):
// - `wet` is known exactly when the state is; unknown, it carries the state's reason.
// - The priors entry is declared by `track-wetness` (`TRACK_WETNESS_PRIORS`, `definePriors('track-wetness', …)`) with an
//   aggregate over a set's dry slick stints; an override replaces it; a source with no slick stint gives no value. Its
//   scale (a lap time, the reference `dryRefMs` gives) is the unit's: the tests assert only that a stint 1 s slower
//   moves it 1 s.
// - A run with the entry in `view.priors` takes `dryRefMs` from it (`dryRefSource.kind` `calibration`) and measures the
//   state against it; a higher reference reads the same laps as a drier track.
// - The slick delta: our car's lap records carry the game's tyre sets (`tyreSets`); the fresh slick set's `lapDeltaMs`
//   against the fitted inter is the game's slick delta. A larger delta reads as a wetter track.
import { carId, known, unknown, type Known, type LapRecord, type PriorsSnapshot, type TrackWetness, type TyreSet } from '@pitwall/domain';
import type { EngineView, PriorDecl, PriorsDecl, StoredSource } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorCar, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { history, lap } from '../../../../test-support/builders/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { trackWetnessCalculator } from '../../src/track-wetness/calculator.ts';
import { TRACK_WETNESS_CONFIG, TRACK_WETNESS_PRIORS } from '../../src/track-wetness/index.ts';
import { guardedQuick } from '../situated.ts';

const calc = guardedQuick(trackWetnessCalculator);
const KEY = 'trackWetness.dryRefMs';

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

const field = (over: (i: number) => Partial<GeneratorCar> = () => ({})): GeneratorCar[] => Array.from({ length: 8 }, (_, i) => aiCar(90_000 + 150 * i, over(i)));
const params = (cars: GeneratorCar[], over: Partial<GeneratorParams>): GeneratorParams => ({ ...GENERATOR_DEFAULTS, cars: cars.length, field: cars, ...over });

/** The view after `frame` with `degradation`'s output on it; priors and config as given. */
function viewOf(race: BuilderRace, frame: number, o: { priors?: EngineView['priors']; config?: EngineView['config']; laps?: (l: LapRecord) => LapRecord } = {}): EngineView {
  const outputs = new Map([[DEGRADATION, degradationCalculator.compute(race.viewAt(frame))]]);
  const view = race.viewAt(frame, { outputs });
  const laps = o.laps;
  return {
    ...view,
    ...(o.priors !== undefined && { priors: o.priors }),
    ...(o.config !== undefined && { config: { ...view.config, ...o.config } }),
    ...(laps !== undefined && { history: { ...view.history, laps: view.history.laps.map((l) => laps(l as LapRecord)) } }),
  } as EngineView;
}

const startOf = (race: BuilderRace, n: number): number => race.framesOfLap(n)[0]!;

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

/** A calibration snapshot holding the dry reference `ms`. */
const snapshot = (ms: number): PriorsSnapshot => ({ fingerprint: `fp-dry-${ms}`, setId: 'dry', setName: 'Dry set', sources: 2, entries: { [KEY]: known(ms, 0) } });

/** The game's sets on our car's laps: the fitted inter (delta 0) and a fresh medium slick `slickDeltaMs` slower. */
const SET = { wearPct: 0, available: true, recommendedSession: 0, lifeSpanLaps: 20, usableLifeLaps: 18 } as const;
const withSlickDelta =
  (slickDeltaMs: number) =>
  (l: LapRecord): LapRecord => {
    if (l.carId !== carId(0)) return l;
    const sets: TyreSet[] = [
      { ...SET, actualCompound: 'inter', visualCompound: 'inter', fitted: true, lapDeltaMs: 0, wearPct: 10 },
      { ...SET, actualCompound: 'C3', visualCompound: 'medium', fitted: false, lapDeltaMs: slickDeltaMs },
    ];
    return { ...l, tyreSets: known(sets, l.completedAt) };
  };

/** Slicks throughout, rain from lap 20 (4 s on every lap): a dry race that turns wet. */
let midRace: BuilderRace;
/** The field on inters from lap 1 in rain on every lap, no stop: no slick lap in the session. */
let wetStart: BuilderRace;

beforeAll(() => {
  midRace = generateRace(params(field(), { laps: 28, rain: { fromLap: 20, wetnessMs: 4_000 } }), 9).race;
  wetStart = generateRace(params(field(() => ({ startCompound: 'inter' })), { laps: 14, rain: { fromLap: 1, wetnessMs: 6_000 } }), 9).race;
});

describe('track-wetness: `wet`, the one wet rule (row 4)', () => {
  it('at every lap of a race that turns wet, wet is wetnessMs − wetSigmas · sdMs > 0', () => {
    const { wetSigmas } = TRACK_WETNESS_CONFIG.defaults;
    let positiveNotWet = 0;
    let wetLaps = 0;
    for (let n = 2; n <= 28; n++) {
      const out: TrackWetness = calc.compute(viewOf(midRace, startOf(midRace, n)));
      if (!out.state.known) {
        expect(out.wet, `lap ${n}`).toEqual(out.state);
        continue;
      }
      const { wetnessMs, sdMs } = out.state.value;
      expect(out.wet, `lap ${n}: ${wetnessMs} ± ${sdMs}`).toEqual(known(wetnessMs - wetSigmas * sdMs > 0, out.state.at));
      if (wetnessMs > 0 && !(wetnessMs - wetSigmas * sdMs > 0)) positiveNotWet++;
      if (valueOf(out.wet)) wetLaps++;
    }
    // the race has dry laps reading a few hundred ms (e.g. +531 ± 416) that are not wet, and rain laps that are
    expect(positiveNotWet).toBeGreaterThan(0);
    expect(wetLaps).toBeGreaterThan(0);
  });

  it('the rule reads its config: wetSigmas 0 makes every positive wetness wet', () => {
    for (let n = 3; n <= 20; n++) {
      const out = calc.compute(viewOf(midRace, startOf(midRace, n), { config: { [TRACK_WETNESS_CONFIG.key]: { wetSigmas: 0 } } }));
      const { wetnessMs } = valueOf(out.state);
      expect(out.wet, `lap ${n}`).toMatchObject({ known: true, value: wetnessMs > 0 });
    }
  });

  it('before the race starts or outside the race, wet is unknown with the state', () => {
    const out = calc.compute(viewOf(midRace, startOf(midRace, 1)));
    expect(out.wet).toEqual(out.state);
    expect(out.wet.known).toBe(false);
  });
});

describe('track-wetness: the dry reference (row 5, C62a)', () => {
  it('a race with dry slick laps has its own dry reference, from this session', () => {
    const out = calc.compute(viewOf(midRace, startOf(midRace, 12)));
    expect(out.dryRefMs.known).toBe(true);
    expect(out.dryRefSource.kind).toBe('session');
  });

  it('without a slick lap the dry reference is the priors entry: dryRefMs from it, the state measured against it', () => {
    const frame = startOf(wetStart, 12);
    const out = calc.compute(viewOf(wetStart, frame, { priors: known(snapshot(91_000), 0) }));
    expect(out.dryRefMs).toMatchObject({ known: true, value: 91_000 });
    expect(out.dryRefSource).toMatchObject({ kind: 'calibration', setName: 'Dry set', sources: 2 });
    const state = valueOf(out.state);
    expect(state.sdMs).toBeGreaterThan(0);
    // a higher dry reference reads the same laps as a drier track
    const higher = valueOf(calc.compute(viewOf(wetStart, frame, { priors: known(snapshot(93_000), 0) })).state);
    expect(higher.wetnessMs).toBeLessThan(state.wetnessMs);
  });

  it('without a slick lap and without a priors entry: the slick delta gives a wetness reading, dryRefMs insufficientData', () => {
    const frame = startOf(wetStart, 12);
    const small = calc.compute(viewOf(wetStart, frame, { laps: withSlickDelta(4_000) }));
    expect(small.dryRefMs).toEqual(unknown('insufficientData'));
    const reading = valueOf(small.state);
    expect(reading.sdMs).toBeGreaterThan(0);
    // a larger delta of the fresh slick against the fitted inter reads as a wetter track
    const large = calc.compute(viewOf(wetStart, frame, { laps: withSlickDelta(10_000) }));
    expect(large.dryRefMs).toEqual(unknown('insufficientData'));
    expect(valueOf(large.state).wetnessMs).toBeGreaterThan(reading.wetnessMs);
  });

  it('no slick lap, no priors entry and no slick delta: state and dryRefMs insufficientData, never 0 (C3)', () => {
    const out = calc.compute(viewOf(wetStart, startOf(wetStart, 12)));
    expect(out.state).toEqual(unknown('insufficientData'));
    expect(out.dryRefMs).toEqual(unknown('insufficientData'));
  });
});

describe('track-wetness: the priors entry trackWetness.dryRefMs (row 5, C62a)', () => {
  const ctx = { config: {}, overrides: {} };

  /** A stored source: car 1's stint of `laps` laps on `compound` from lap 2, each lap `ms(i)`. */
  const source = (session: number, compound: 'C3' | 'inter', ms: (i: number) => number): StoredSource => {
    const visual = compound === 'inter' ? 'inter' : 'medium';
    const laps = Array.from({ length: 12 }, (_, i) =>
      lap({ carId: carId(1), lapNumber: i + 2, lapTimeMs: ms(i), actualCompound: compound, visualCompound: visual, tyreAgeAtStart: i, completedAt: (i + 2) * 95_000, fuelAtStartKg: known(100 - 1.6 * i, 0), fuelAtEndKg: known(98.4 - 1.6 * i, 0) }),
    );
    return {
      source: { sessionUid: `${session}`, weekendId: 'w1', feedCar: carId(0), car: carId(1), firstLap: 2, excludedLaps: [] },
      phase: { kind: 'race', format: 'grandPrix' },
      aiDifficulty: unknown('notReceived'),
      projection: history({ laps }),
      stint: { carId: carId(1), firstLap: 2, lastLap: 13, actualCompound: compound, visualCompound: visual, tyreAgeAtFitting: 0, frame: 200 },
      laps,
      pitStops: [],
      sessionLaps: laps,
      track: unknown('notApplicable'),
    };
  };

  const entry = (): { decl: PriorDecl; aggregate: NonNullable<PriorDecl['aggregate']> } => {
    const decl = (TRACK_WETNESS_PRIORS as PriorsDecl).entries[KEY];
    if (decl?.aggregate === undefined) throw new Error(`${KEY} declares an aggregate`);
    return { decl, aggregate: decl.aggregate };
  };

  it('is declared by track-wetness under trackWetness.dryRefMs', () => {
    expect(TRACK_WETNESS_PRIORS.unit).toBe('track-wetness');
    expect(Object.keys(TRACK_WETNESS_PRIORS.entries)).toContain(KEY);
    expect(entry().decl.version).toBeGreaterThanOrEqual(1);
  });

  it('aggregates a set`s dry slick stints: a stint 1 s slower moves it 1 s', () => {
    const { aggregate } = entry();
    const base = aggregate([source(1, 'C3', (i) => 90_000 + 40 * i + (i % 3) * 30)], ctx);
    const slower = aggregate([source(1, 'C3', (i) => 91_000 + 40 * i + (i % 3) * 30)], ctx);
    expect(base.known).toBe(true);
    expect(valueOf(slower) - valueOf(base)).toBeCloseTo(1_000, -1);
  });

  it('an inter stint is no dry reference; no source gives none; an override replaces the aggregate', () => {
    const { aggregate } = entry();
    expect(aggregate([source(1, 'inter', (i) => 98_000 + 40 * i)], ctx)).toEqual(unknown('insufficientData'));
    expect(aggregate([], ctx)).toEqual(unknown('insufficientData'));
    expect(aggregate([source(1, 'C3', (i) => 90_000 + 40 * i)], { config: {}, overrides: { [KEY]: 89_500 } })).toEqual(known(89_500, 0));
  });
});
