// `rival-stops`' qualifying row (SP4.3d2 Task 6, SP4.3d spec §7.2; contract C3, C14, C43, C44, C62d): the planning job
// runs the race's starting point on the ended qualifying session's as-of view, its `fixed.totalLaps` the race's entered
// laps (C62d). On it every car in the session gets, per dry start compound, the window of its first stop on a fresh set
// of it from lap 1 (`byStartCompound`), from the tyre units' fresh-set life on their priors; no stop of qualifying counts
// as a race stop seen, and the race row's own window is unset. Practice and `none` stay `notApplicable`, without
// `byStartCompound`; the race row sets none.
import { carId, known, unknown, type CarState, type LapRecord, type NoiseCompound, type OpenSpan, type RivalStop, type StintRecord, type TyreModelOutput } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { RIVAL_STOPS_BEHAVIOUR } from '../../src/rival-stops/behaviour.ts';
import { rivalStopsCalculator } from '../../src/rival-stops/calculator.ts';
import { rivalStopsAsOf, type RivalStopsOutput } from '../../src/rival-stops/index.ts';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../../src/tyre-life/index.ts';
import { TYRE_MODEL } from '../../src/tyre-model/index.ts';
import { plainModelCar } from '../tyre-model/support.ts';
import { NONE, openSpan, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';

/** The race's laps as the user entered them in the planning round. */
const RACE_LAPS = 44;

/** A fresh set's laps to the limit per compound, as `tyre-model` has them on its priors. */
const FRESH_LIFE: Partial<Record<NoiseCompound, number>> = { soft: 12, medium: 20, hard: 30 };

/** The cars of the session: 0 to 3 competing, car 4 absent (its slot not in the session). */
const CARS = [0, 1, 2, 3];
const ABSENT = 4;

const K = <T>(value: T): ReturnType<typeof known<T>> => known(value, 0);

/** `tyre-life`'s output for a car's qualifying set: worn, 3 laps to its limit (no race set). */
const qualifyingSet = (): TyreLife => {
  const corner = { wearPct: K(40), ratePctPerLap: K(6), lapsToLimit: K(3) };
  return { corners: { fl: corner, fr: corner, rl: corner, rr: corner }, lapsToLimit: K(3), limitPct: 70, gameLifeSpanLaps: unknown('notReceived') };
};

/**
 * A car's qualifying runs: two runs of 3 laps on softs (out lap, push lap, in lap), a stop between them; with `stops`
 * its first run's stint is closed in the projection, as qualifying's pit visits close it.
 */
function runsOf(car: number, stops: boolean): { laps: LapRecord[]; stints: StintRecord[] } {
  const laps = Array.from({ length: 6 }, (_, i) => {
    const n = i + 1;
    const run = n <= 3 ? 0 : 1;
    return lap({
      carId: carId(car),
      lapNumber: n,
      completedAt: n * 95_000 + car * 100,
      visualCompound: 'soft',
      actualCompound: 'C3',
      tyreAgeAtStart: n - 1 - 3 * run,
      outLap: n === 1 || n === 4,
      inLap: n === 3 || n === 6,
      positionAtEnd: car + 1,
      frame: n * 20 + car,
    });
  });
  const stints: StintRecord[] = stops ? [{ carId: carId(car), firstLap: 1, lastLap: 3, actualCompound: 'C3', visualCompound: 'soft', tyreAgeAtFitting: 0, frame: 3 * 20 + 10 + car }] : [];
  return { laps, stints };
}

/** The ended session of weekend phase `phase` (default qualifying) as of its end, with `tyre-life`'s and `tyre-model`'s outputs. */
function endedSession(o: { phase?: typeof RACE; stops?: boolean; fresh?: Partial<Record<NoiseCompound, number>> } = {}): EngineView {
  const phase = o.phase ?? QUALIFYING;
  const runs = CARS.map((car) => runsOf(car, o.stops ?? true));
  const states: CarState[] = CARS.map((car) => carState({ id: carId(car), timing: { lap: 7, position: car + 1 }, tyres: { visualCompound: 'soft', actualCompound: 'C3', age: 3 } }));
  const spans: OpenSpan[] = [...CARS.map((car) => openSpan('car-driver', 'ai', { car })), openSpan('session-phase-qualifying', 'finished')];
  const tyreLife: TyreLifeOutput = Object.fromEntries(CARS.map((car) => [carId(car), qualifyingSet()]));
  const tyreModel: TyreModelOutput = Object.fromEntries(CARS.map((car) => [carId(car), plainModelCar({ lives: o.fresh ?? FRESH_LIFE })]));
  return situatedView({
    phase,
    cars: states,
    status: { [ABSENT]: 'absent' },
    session: { totalLaps: 0 },
    sessionTime: 7 * 95_000,
    history: {
      laps: runs.flatMap((r) => r.laps).sort((a, b) => a.frame - b.frame),
      stints: runs.flatMap((r) => r.stints).sort((a, b) => a.frame - b.frame),
    },
    spans,
    outputs: new Map<string, unknown>([
      [TYRE_LIFE, tyreLife],
      [TYRE_MODEL, tyreModel],
    ]),
  });
}

/** The planning view (C62d): the session's as-of view with `fixed.totalLaps` the race's entered laps. */
const planningView = (view: EngineView, totalLaps: number = RACE_LAPS): AsOfView => {
  const now = asOfNow(view);
  return { ...now, fixed: { ...now.fixed, totalLaps: known(totalLaps, 0) } };
};

const stopOf = (out: RivalStopsOutput, car: number): RivalStop => {
  const stop = out[carId(car)];
  expect(stop, `car ${car} has an entry`).toBeDefined();
  return stop!;
};

type Window = { lowLap: number; midLap: number; highLap: number };
const windowOf = (stop: RivalStop, compound: NoiseCompound): Window => {
  const w = stop.byStartCompound?.[compound];
  expect(w, `byStartCompound.${compound}`).toBeDefined();
  return w!;
};

const DRY = ['soft', 'medium', 'hard'] as const;

describe("rival-stops' qualifying row (SP4.3d2 Task 6)", () => {
  it('the behaviour table gives qualifying values; practice and none stay notApplicable', () => {
    const rows = RIVAL_STOPS_BEHAVIOUR['weekend-phase']!;
    expect(rows['qualifying']?.notApplicable).not.toBe(true);
    for (const kind of ['practice', 'none']) expect(rows[kind]?.notApplicable, kind).toBe(true);
  });

  it("a qualifying session's as-of view gives every car in the session byStartCompound per dry compound (not notApplicable)", () => {
    const out = rivalStopsAsOf(planningView(endedSession()));
    expect(Object.keys(out).map(Number).sort((a, b) => a - b)).toEqual(CARS);
    for (const car of CARS) {
      const stop = stopOf(out, car);
      for (const c of DRY) {
        const w = windowOf(stop, c);
        expect(w.lowLap, `car ${car} ${c}`).toBeGreaterThanOrEqual(1);
        expect(w.lowLap, `car ${car} ${c}`).toBeLessThanOrEqual(w.midLap);
        expect(w.midLap, `car ${car} ${c}`).toBeLessThanOrEqual(w.highLap);
        expect(w.highLap, `car ${car} ${c}`).toBeLessThanOrEqual(RACE_LAPS);
      }
    }
  });

  it('byStartCompound.soft.midLap < medium.midLap < hard.midLap', () => {
    const out = rivalStopsAsOf(planningView(endedSession()));
    for (const car of CARS) {
      const stop = stopOf(out, car);
      const [soft, medium, hard] = DRY.map((c) => windowOf(stop, c).midLap);
      expect(soft, `car ${car}`).toBeLessThan(medium!);
      expect(medium, `car ${car}`).toBeLessThan(hard!);
    }
  });

  it("the windows come from a fresh set's life from lap 1, not from qualifying's worn set", () => {
    // tyre-life's set has 3 laps to its limit for every car; the fresh sets 12, 20 and 30 laps
    const out = rivalStopsAsOf(planningView(endedSession()));
    for (const c of DRY) expect(windowOf(stopOf(out, 0), c).midLap, c).toBeGreaterThan(3);
    // a longer fresh hard moves the hard window later, the others stay
    const longer = rivalStopsAsOf(planningView(endedSession({ fresh: { ...FRESH_LIFE, hard: 36 } })));
    expect(windowOf(stopOf(longer, 0), 'hard').midLap).toBeGreaterThan(windowOf(stopOf(out, 0), 'hard').midLap);
    expect(windowOf(stopOf(longer, 0), 'soft')).toEqual(windowOf(stopOf(out, 0), 'soft'));
    expect(windowOf(stopOf(longer, 0), 'medium')).toEqual(windowOf(stopOf(out, 0), 'medium'));
  });

  it("no stop seen: qualifying's pit visits are no race stops, and the race row's own window is unset", () => {
    const withStops = rivalStopsAsOf(planningView(endedSession({ stops: true })));
    const without = rivalStopsAsOf(planningView(endedSession({ stops: false })));
    for (const car of CARS) {
      expect(stopOf(withStops, car).byStartCompound, `car ${car}`).toEqual(stopOf(without, car).byStartCompound);
      expect(stopOf(withStops, car).window.known, `car ${car}`).toBe(false);
    }
  });

  it('the windows end at the race: a shorter race caps them at its last lap', () => {
    const out = rivalStopsAsOf(planningView(endedSession(), 25));
    for (const c of DRY) expect(windowOf(stopOf(out, 0), c).highLap, c).toBeLessThanOrEqual(25);
  });

  it('practice rows unchanged: practice and none stay notApplicable, without byStartCompound', () => {
    for (const phase of [PRACTICE, NONE]) {
      const stop = stopOf(rivalStopsAsOf(planningView(endedSession({ phase: phase as typeof RACE }))), 0);
      expect(stop.window, phase.kind).toEqual(unknown('notApplicable'));
      expect(stop.nextCompound, phase.kind).toEqual(unknown('notApplicable'));
      expect(stop.owesStop, phase.kind).toEqual(unknown('notApplicable'));
      expect(stop.byStartCompound, phase.kind).toBeUndefined();
    }
  });

  it('the race row sets no byStartCompound', () => {
    const view = endedSession({ phase: RACE, stops: false });
    for (const stop of Object.values(rivalStopsCalculator.compute(view))) expect(stop.byStartCompound).toBeUndefined();
  });
});
