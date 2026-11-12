// `rival-stops` (SP4.3a spec 5.3; plan Task 11): per rival the next stop's window, the next compound's odds and whether
// it owes a stop. R1 and R2 run on one generated race (Task 7's generator, built once in `beforeAll`), the rows on
// builder views; R4 runs it through its guarded view (C41). The rows hand the unit `tyre-life`'s output, and also
// `session-remaining`'s, so the laps left reach it however its "as of" form reads them (see the task report).
import {
  carId,
  known,
  unknown,
  type CarState,
  type Known,
  type LapRecord,
  type OpenSpan,
  type PitStopRecord,
  type RivalStop,
  type StintRecord,
  type TyreSet,
  type NoiseCompound,
} from '@pitwall/domain';
import { asOfNow, projectionAsOf, projectionLengths, type EngineView, type MembershipSource } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { RIVAL_STOPS, RIVAL_STOPS_CONFIG, rivalStopsAsOf, type RivalStopsOutput } from '../../src/rival-stops/index.ts';
import { rivalStopsCalculator as unguarded } from '../../src/rival-stops/calculator.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../../src/session-remaining/index.ts';
import { sessionRemainingCalculator } from '../../src/session-remaining/calculator.ts';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../../src/tyre-life/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { UndeclaredReadError } from '../../../engine/test/support/guarded-input.ts';
import { engineShaped } from '../engine-shaped.ts';
import { guardedQuick, NONE, openSpan, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';
import { behaviourExport, CALCULATORS, loadUnitFolders } from '../units.ts';

/**
 * The calculator as the rows run it. Its guarded view (C41) has its own test below (R4) besides the generic one: the
 * rows stay unguarded so each fails on its own behaviour.
 */
const rivalStops = unguarded;

const SPREAD = RIVAL_STOPS_CONFIG.defaults.noPeerSpreadLaps;
const TOTAL_LAPS = 50;

// ---------------------------------------------------------------------------------------------------------------------
// The generated race (R1, R2): 8 cars on mediums, each stopping once for hards at tyre age 18 ± 2.

/** The in laps of the field, car by car: after the fifth stop (laps 16, 17, 18, 18, 18) the peers' median age is 18. */
const STOP_LAPS = [16, 17, 18, 18, 18, 19, 20, 20];
const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: STOP_LAPS.length,
  laps: 24,
  field: STOP_LAPS.map((stopLap, i) => ({ ...GENERATOR_DEFAULTS.field[i]!, human: false, stops: [{ lap: stopLap, compound: 'hard' }], startCompound: 'medium' })),
};

/** The upstream units' outputs at frame `frame`, as the scheduled run has them then: `degradation`, `tyre-life`, `session-remaining`. */
function upstreamAt(race: BuilderRace, frame: number): Map<string, unknown> {
  const outputs = new Map<string, unknown>();
  outputs.set(DEGRADATION, degradationCalculator.compute(race.viewAt(frame, { outputs })));
  outputs.set(TYRE_LIFE, tyreLifeCalculator.compute(race.viewAt(frame, { outputs })));
  outputs.set(SESSION_REMAINING, sessionRemainingCalculator.compute(race.viewAt(frame, { outputs })));
  return outputs;
}

/**
 * The race's last view as a source the projection module can cut (`projectionAsOf`): the generator's views keep no
 * append frames, so each entry's is the first frame whose view holds it (every list only grows in a generated race).
 */
function cutSource(race: BuilderRace): MembershipSource {
  const appendedAt: Record<string, number[]> = {};
  for (let frame = 1; frame <= race.lastFrame; frame++) {
    const lengths = projectionLengths(race.viewAt(frame).history);
    for (const [list, n] of Object.entries(lengths)) {
      const frames = (appendedAt[list] ??= []);
      while (frames.length < (n ?? 0)) frames.push(frame);
    }
  }
  const last = race.viewAt(race.lastFrame);
  return { history: { ...last.history, appendedAt }, situation: last.situation };
}

/** The leader's crossing frames: the first frame of each of its laps. */
const crossingFrames = (race: BuilderRace): number[] =>
  Array.from({ length: race.laps }, (_, i) => race.framesOfLap(i + 1)[0]).filter((f): f is number => f !== undefined);

let race: BuilderRace;
let source: MembershipSource;

beforeAll(() => {
  race = generateRace(PARAMS, 11).race;
  source = cutSource(race);
});

describe('rival-stops on a generated race', () => {
  it('R1 recovers the generator\'s parameters within its noise: a medium runner\'s window mid within 1 lap of 18 after five peers stopped', () => {
    // the first leader crossing on which five stints (all on mediums) are in the projection
    const frame = crossingFrames(race).find((f) => race.viewAt(f).history.stints.length >= 5);
    expect(frame).toBeDefined();
    const view = race.viewAt(frame!, { outputs: upstreamAt(race, frame!) });
    expect(view.history.stints.slice(0, 5).every((s) => s.visualCompound === 'medium')).toBe(true);
    // car 7 (in lap 20) is still on its first set of mediums
    const runner = carId(7);
    expect(view.history.stints.some((s) => s.carId === runner)).toBe(false);
    const stop = rivalStops.compute(view)[runner]!;
    expect(stop.basis).toBe('peers');
    expect(stop.window.known).toBe(true);
    if (!stop.window.known) return;
    const { lowLap, midLap, highLap } = stop.window.value;
    expect(Math.abs(midLap - 18)).toBeLessThanOrEqual(1);
    expect(lowLap).toBeLessThanOrEqual(midLap);
    expect(midLap).toBeLessThanOrEqual(highLap);
  });

  it('the cut source gives the generator\'s projection at every leader crossing (the helper R2 rests on)', () => {
    for (const frame of crossingFrames(race)) {
      const cut = projectionAsOf(source, frame).history;
      const view = race.viewAt(frame).history;
      expect(cut.laps).toEqual(view.laps);
      expect(cut.stints).toEqual(view.stints);
      expect(cut.pitStops).toEqual(view.pitStops);
    }
  });

  it('R2 as of frame N equals the scheduled run at every leader crossing frame', () => {
    const frames = crossingFrames(race);
    expect(frames.length).toBe(PARAMS.laps);
    for (const frame of frames) {
      const outputs = upstreamAt(race, frame);
      const view = race.viewAt(frame, { outputs });
      const cut = projectionAsOf(source, frame);
      const asOf = rivalStopsAsOf({ ...asOfNow(view), history: cut.history, situation: cut.situation, frame, outputs });
      expect(asOf, `frame ${frame}`).toEqual(unguarded.compute(view));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Builder views (rows 2-6, R3).

const K = <T>(value: T): Known<T> => known(value, 0);

/** `tyre-life`'s entry for a car: `lapsToLimit` for its set (every corner the same), each compound's fresh-set life. */
function life(lapsToLimit: number, fresh: Partial<Record<NoiseCompound, number>>): TyreLife {
  const corner = { wearPct: K(10), ratePctPerLap: K(2), lapsToLimit: K(lapsToLimit) };
  const freshLife = (c: NoiseCompound): Known<number> => (fresh[c] === undefined ? unknown('insufficientData') : K(fresh[c]));
  return {
    corners: { fl: corner, fr: corner, rl: corner, rr: corner },
    lapsToLimit: K(lapsToLimit),
    basis: 'wear',
    limitPct: 70,
    ageLossLimitMs: 2_000,
    freshLifeLaps: { soft: freshLife('soft'), medium: freshLife('medium'), hard: freshLife('hard'), inter: freshLife('inter'), wet: freshLife('wet') } as TyreLife['freshLifeLaps'],
    gameLifeSpanLaps: unknown('notReceived'),
  };
}

const ACTUAL = { soft: 'C3', medium: 'C2', hard: 'C1', inter: 'inter', wet: 'wet' } as const;

/** One car's race so far: its stints (first lap and compound each; the last one runs on), `completed` laps, its stops between them. */
type CarRace = { car: number; stints: { from: number; compound: NoiseCompound }[]; completed: number; rule?: 'required' | 'waived'; life: TyreLife; sets?: TyreSet[] };

/** The car's laps 1..completed, each on the set of its stint (tyre age at start counting from the stint's first lap). */
function lapsOf(r: CarRace): LapRecord[] {
  return Array.from({ length: r.completed }, (_, i) => {
    const n = i + 1;
    const stint = r.stints.findLast((s) => s.from <= n)!;
    const next = r.stints.find((s) => s.from > n);
    return lap({
      carId: carId(r.car),
      lapNumber: n,
      completedAt: n * 90_000 + r.car * 100,
      visualCompound: stint.compound,
      actualCompound: ACTUAL[stint.compound],
      tyreAgeAtStart: n - stint.from,
      inLap: next !== undefined && next.from === n + 1,
      outLap: n > 1 && stint.from === n,
      positionAtEnd: r.car + 1,
      frame: n * 20 + r.car,
    });
  });
}

/** The car's closed stints (each ended by a stop) and its pit stops. */
function stopsOf(r: CarRace): { stints: StintRecord[]; pitStops: PitStopRecord[] } {
  const stints: StintRecord[] = [];
  const pitStops: PitStopRecord[] = [];
  r.stints.slice(1).forEach((next, i) => {
    const before = r.stints[i]!;
    const inLap = next.from - 1;
    const exit = inLap * 90_000 + 25_000;
    stints.push({ carId: carId(r.car), firstLap: before.from, lastLap: inLap, actualCompound: ACTUAL[before.compound], visualCompound: before.compound, tyreAgeAtFitting: 0, frame: inLap * 20 + 10 });
    pitStops.push({ carId: carId(r.car), lap: inLap, pitLaneEntry: exit - 22_000, pitLaneExit: exit, pitLaneTimeMs: 22_000, stationaryTimeMs: 2_500, flag: 'green', penaltyServed: false, frame: inLap * 20 + 10 });
  });
  return { stints, pitStops };
}

const byFrame = <T extends { frame: number }>(list: T[]): T[] => [...list].sort((a, b) => a.frame - b.frame);

/** The race view of `cars`: their laps, stints and stops in the projection, their compound-rule and car-driver spans open, `tyre-life`'s output and the laps left. */
function raceView(cars: CarRace[], o: { phase?: typeof RACE; shaped?: boolean } = {}): EngineView {
  const laps = byFrame(cars.flatMap(lapsOf));
  const stops = cars.map(stopsOf);
  const leaderLaps = Math.max(...cars.map((c) => c.completed));
  const states: CarState[] = cars.map((r) => {
    const stint = r.stints.at(-1)!;
    return carState({
      id: carId(r.car),
      timing: { lap: r.completed + 1, position: r.car + 1 },
      tyres: {
        visualCompound: stint.compound,
        actualCompound: ACTUAL[stint.compound],
        age: r.completed + 1 - stint.from,
        ...(r.sets && { sets: known({ sets: r.sets, fittedIdx: r.sets.findIndex((s) => s.fitted) }, 0) }),
      },
    });
  });
  const spans: OpenSpan[] = cars.flatMap((r) => [openSpan('compound-rule', r.rule ?? 'required', { car: r.car }), openSpan('car-driver', 'ai', { car: r.car })]);
  const tyreLife: TyreLifeOutput = Object.fromEntries(cars.map((r) => [carId(r.car), r.life]));
  const remaining: SessionRemaining = { basis: 'laps', lapsLeft: K(TOTAL_LAPS - leaderLaps), timeLeftMs: unknown('notApplicable') };
  return situatedView({
    phase: o.phase ?? RACE,
    cars: states,
    session: { totalLaps: TOTAL_LAPS },
    sessionTime: (leaderLaps + 0.1) * 90_000,
    history: {
      laps: o.shaped ? engineShaped(laps) : laps,
      stints: byFrame(stops.flatMap((s) => s.stints)),
      pitStops: byFrame(stops.flatMap((s) => s.pitStops)),
    },
    spans,
    outputs: new Map<string, unknown>([
      [TYRE_LIFE, tyreLife],
      [SESSION_REMAINING, remaining],
    ]),
  });
}

const stopOf = (out: RivalStopsOutput, car: number): RivalStop => {
  const stop = out[carId(car)];
  expect(stop, `car ${car} has an entry`).toBeDefined();
  return stop!;
};

/** The odds above 0, by compound. */
const oddsOf = (stop: RivalStop): Record<string, number> => {
  expect(stop.nextCompound.known).toBe(true);
  if (!stop.nextCompound.known) return {};
  return Object.fromEntries(Object.entries(stop.nextCompound.value).filter(([, p]) => (p ?? 0) > 0)) as Record<string, number>;
};

const MEDIUM_FROM_1 = [{ from: 1, compound: 'medium' as const }];

describe('rival-stops rows', () => {
  it('row 2: before any peer stop the window is tyre-life\'s predicted life ± noPeerSpreadLaps, basis tyreLife', () => {
    // three cars on fresh mediums from lap 1, 5 laps done; each set reaches its limit at the end of lap 20 (15 laps from
    // the end of lap 5, a fresh medium's life 20 laps)
    const cars = [0, 1, 2].map((car): CarRace => ({ car, stints: MEDIUM_FROM_1, completed: 5, life: life(15, { medium: 20, hard: 30, soft: 12 }) }));
    const out = rivalStops.compute(raceView(cars));
    for (const car of [0, 1, 2]) {
      const stop = stopOf(out, car);
      expect(stop.basis).toBe('tyreLife');
      expect(stop.window).toMatchObject({ known: true, value: { lowLap: 20 - SPREAD, midLap: 20, highLap: 20 + SPREAD, toFlag: false } });
      expect(stop.owesStop).toMatchObject({ known: true, value: true });
    }
  });

  it('row 3: a car owing no stop and with life to the flag gets toFlag, basis noStop', () => {
    // both stopped at the end of lap 20, medium to hard (compound rule waived), 40 laps done of 50: car 0's hards last
    // 25 more laps (to the flag), car 1's only 5 (a fresh hard's life 25 laps from lap 21: its in lap 45)
    const twoStints = [{ from: 1, compound: 'medium' as const }, { from: 21, compound: 'hard' as const }];
    const out = rivalStops.compute(
      raceView([
        { car: 0, stints: twoStints, completed: 40, rule: 'waived', life: life(25, { medium: 20, hard: 45 }) },
        { car: 1, stints: twoStints, completed: 40, rule: 'waived', life: life(5, { medium: 20, hard: 25 }) },
      ]),
    );
    const toFlag = stopOf(out, 0);
    expect(toFlag.owesStop).toMatchObject({ known: true, value: false });
    expect(toFlag.basis).toBe('noStop');
    expect(toFlag.window).toMatchObject({ known: true, value: { toFlag: true, highLap: TOTAL_LAPS } });
    // owing no stop is not enough: a set that does not last to the flag still needs a stop
    const short = stopOf(out, 1);
    expect(short.owesStop).toMatchObject({ known: true, value: false });
    expect(short.basis).not.toBe('noStop');
    expect(short.window).toMatchObject({ known: true, value: { toFlag: false, midLap: 45 } });
  });

  it('row 4: a car out of sets gets toFlag', () => {
    // car 0 (ours: its sets are known) owes its stop and its mediums last 10 more laps, but no other set is left to fit
    const set = (visualCompound: NoiseCompound, fitted: boolean): TyreSet => ({
      actualCompound: ACTUAL[visualCompound],
      visualCompound,
      wearPct: fitted ? 20 : 60,
      available: fitted,
      fitted,
      recommendedSession: 0,
      lifeSpanLaps: 20,
      usableLifeLaps: 20,
      lapDeltaMs: 0,
    });
    const out = rivalStops.compute(
      raceView([
        { car: 0, stints: MEDIUM_FROM_1, completed: 10, life: life(10, { medium: 20, hard: 30 }), sets: [set('medium', true), set('hard', false), set('soft', false), set('hard', false)] },
        { car: 1, stints: MEDIUM_FROM_1, completed: 10, life: life(10, { medium: 20, hard: 30 }) },
      ]),
    );
    expect(stopOf(out, 0).window).toMatchObject({ known: true, value: { toFlag: true, highLap: TOTAL_LAPS } });
    // the same car with sets of unknown count (a rival) keeps its window
    expect(stopOf(out, 1).window).toMatchObject({ known: true, value: { toFlag: false, midLap: 20 } });
  });

  it('row 5: the window is capped by the laps left', () => {
    // 40 laps done of 50, no peer stop, the mediums reach their limit at the end of lap 52: 48 .. 52 .. 56, capped at 50
    const out = rivalStops.compute(raceView([{ car: 0, stints: MEDIUM_FROM_1, completed: 40, life: life(12, { medium: 52, hard: 60 }) }]));
    const stop = stopOf(out, 0);
    expect(stop.basis).toBe('tyreLife');
    expect(stop.window).toMatchObject({ known: true, value: { lowLap: 52 - SPREAD, midLap: TOTAL_LAPS, highLap: TOTAL_LAPS } });
  });

  describe('row 6: next-compound odds from this race\'s peers\' choices, else the compound rule\'s required types', () => {
    it('from the peers\' choices: three of four peers fitted hards, one softs', () => {
      const peer = (car: number, compound: NoiseCompound): CarRace => ({
        car,
        stints: [{ from: 1, compound: 'medium' }, { from: 19, compound }],
        completed: 20,
        rule: 'waived',
        life: life(20, { medium: 18, hard: 30, soft: 12 }),
      });
      const out = rivalStops.compute(
        raceView([
          { car: 0, stints: MEDIUM_FROM_1, completed: 20, life: life(2, { medium: 22, hard: 30, soft: 12 }) },
          peer(1, 'hard'),
          peer(2, 'hard'),
          peer(3, 'hard'),
          peer(4, 'soft'),
        ]),
      );
      expect(oddsOf(stopOf(out, 0))).toEqual({ hard: 0.75, soft: 0.25 });
    });

    it('before any peer stop: the dry compounds the compound rule still requires, evenly', () => {
      const out = rivalStops.compute(
        raceView([
          { car: 0, stints: MEDIUM_FROM_1, completed: 5, life: life(15, { medium: 20, hard: 30, soft: 12 }) },
          { car: 1, stints: [{ from: 1, compound: 'soft' }], completed: 5, life: life(7, { medium: 20, hard: 30, soft: 12 }) },
        ]),
      );
      expect(oddsOf(stopOf(out, 0))).toEqual({ soft: 0.5, hard: 0.5 });
      expect(oddsOf(stopOf(out, 1))).toEqual({ medium: 0.5, hard: 0.5 });
    });

    it('the odds sum to 1', () => {
      const out = rivalStops.compute(raceView([{ car: 0, stints: MEDIUM_FROM_1, completed: 5, life: life(15, { medium: 20 }) }]));
      const odds = oddsOf(stopOf(out, 0));
      expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    });
  });

  it('notApplicable outside the race phase (weekend-phase row)', () => {
    for (const phase of [PRACTICE, QUALIFYING, NONE]) {
      const out = rivalStops.compute(raceView([{ car: 0, stints: MEDIUM_FROM_1, completed: 5, life: life(15, { medium: 20 }) }], { phase: phase as typeof RACE }));
      const stop = stopOf(out, 0);
      expect(stop.window, phase.kind).toEqual(unknown('notApplicable'));
      expect(stop.nextCompound, phase.kind).toEqual(unknown('notApplicable'));
      expect(stop.owesStop, phase.kind).toEqual(unknown('notApplicable'));
    }
  });

  it('R3 rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    // engine-shaped laps (provisional, then confirmed); car 1 stops at the end of lap 18; a flashback to lap 16 undoes it
    const at = (completed: number): CarRace[] => [
      { car: 0, stints: MEDIUM_FROM_1, completed, life: life(20 - completed, { medium: 20, hard: 30 }) },
      { car: 1, stints: completed > 18 ? [{ from: 1, compound: 'medium' }, { from: 19, compound: 'hard' }] : MEDIUM_FROM_1, completed, rule: completed > 18 ? 'waived' : 'required', life: life(20 - completed, { medium: 20, hard: 30 }) },
    ];
    const full = raceView(at(20), { shaped: true });
    expect(stopOf(rivalStops.compute(full), 0).basis).toBe('peers');
    const never = raceView(at(16), { shaped: true });
    const rewound: EngineView = { ...never, delta: { before: projectionLengths(full.history), after: projectionLengths(never.history), rewound: { frameId: 16 * 20, at: never.live.sessionTime } } };
    const out = rivalStops.compute(rewound);
    expect(out).toEqual(rivalStops.compute(never));
    expect(stopOf(out, 0).basis).toBe('tyreLife');
  });
});

describe('rival-stops in the generic tests (R4: C41, C44)', () => {
  it('the package registers it: a quick calculator on lapCompleted, picked up by the guarded-view test', () => {
    const calc = CALCULATORS.find((c) => c.id === RIVAL_STOPS);
    expect(calc).toBeDefined();
    expect(calc).toMatchObject({ kind: 'quick', cadence: 'lapCompleted' });
    expect(calc?.reads).toEqual(expect.arrayContaining(['stints', 'pitStops', 'laps', 'spans:compound-rule', 'spans:car-driver', 'spans:car-status', 'spans:weekend-phase', { calculator: TYRE_LIFE }]));
  });

  it('it computes through its guarded view: no read it does not declare (C41)', () => {
    const view = raceView([
      { car: 0, stints: MEDIUM_FROM_1, completed: 20, life: life(2, { medium: 22, hard: 30 }) },
      { car: 1, stints: [{ from: 1, compound: 'medium' }, { from: 19, compound: 'hard' }], completed: 20, rule: 'waived', life: life(20, { medium: 18, hard: 30 }) },
    ]);
    expect(() => guardedQuick(unguarded).compute(view)).not.toThrow(UndeclaredReadError);
    expect(guardedQuick(unguarded).compute(view)).toEqual(unguarded.compute(view));
  });

  it('its index exports a behaviour table over every sub-machine it reads, picked up by the completeness test', async () => {
    const folder = (await loadUnitFolders()).find((f) => f.unit === RIVAL_STOPS);
    expect(folder?.table, behaviourExport(RIVAL_STOPS)).toBeDefined();
    expect(Object.keys(folder?.table ?? {}).sort()).toEqual(['car-driver', 'car-status', 'compound-rule', 'weekend-phase']);
  });
});
