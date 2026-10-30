// `lap-times` (spec 6.2): the projection part of the calculator output, per car.
import { carId, known, unknown, type CarTiming, type LapRecord } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { field } from '../../../../test-support/builders/index.ts';
import { LAP_TIMES_CONFIG } from '../../src/lap-times/index.ts';
import { activeCars, lapInProgress, PRACTICE, Q1, RACE, run, scene } from './scene.ts';

const notApplicable = unknown('notApplicable');
const insufficientData = unknown('insufficientData');

describe('lap-times projection', () => {
  it("projection at crossing 25 of a lap 0.3 s up on the best lap's crossing 25 projects best − 300 ms", () => {
    // 3 cars with best laps of 90.0, 89.8 and 89.6 s; car 0 starts lap 3 at 180 s and is 0.3 s up at crossing 25
    const { laps, miniSectors } = field({ cars: 3, laps: 2, paceMs: [90_000, 89_800, 89_600] });
    const live = lapInProgress(0, 3, 90_000, 180_000, 25, 300);
    const latest = live[live.length - 1]!.at; // 180 000 + 45 000 − 300
    const cars = activeCars(3, { 0: { lap: 3, driverStatus: 'flyingLap', currentLapTimeMs: latest - 180_000 } });
    const out = run(scene({ laps, miniSectors: [...miniSectors, ...live], cars, sessionTime: latest }));

    expect(Object.keys(out.projections).map(Number).sort()).toEqual([0, 1, 2]);
    const p = out.projections[carId(0)]!;
    expect(p.carId).toBe(0);
    expect(p.onLap).toBe(true);
    // 44 700 ms elapsed + (90 000 − 45 000)
    expect(p.projectedLapMs).toEqual(known(89_700, latest));
    expect(p.deltaToBestMs).toEqual(known(-300, latest));
    // between car 2's 89.6 and car 1's 89.8
    expect(p.projectedPosition).toEqual(known(2, latest));
    // no cut-off outside qualifying
    expect(p.cutOff).toEqual(notApplicable);
  });

  /** A car's lap 3 crossings up to `segment` after two laps at `paceMs`, and the car state that goes with them. */
  const lapThree = (timing: Partial<CarTiming>, lapsOver: Partial<LapRecord> = {}) => {
    const { laps, miniSectors } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    Object.assign(laps[1]!, lapsOver); // lap 2
    const live = lapInProgress(0, 3, 90_000, 180_000, 25);
    const sessionTime = live[live.length - 1]!.at;
    return scene({ laps, miniSectors: [...miniSectors, ...live], cars: activeCars(1, { 0: { lap: 3, ...timing } }), session: Q1, sessionTime });
  };

  it.each<[string, Partial<CarTiming>, Partial<LapRecord>]>([
    ['an out lap', { driverStatus: 'outLap' }, {}],
    ['an in lap', { driverStatus: 'inLap' }, {}],
    ['in the garage', { driverStatus: 'inGarage' }, {}],
    ['in the pit lane', { driverStatus: 'onTrack', pitStatus: 'pitting' }, {}],
    ['the lap after an in lap', { driverStatus: 'onTrack' }, { inLap: true }],
  ])('no projection on an in or out lap (onLap false, the projection notApplicable; the cut-off is not ours): %s', (_, timing, lapsOver) => {
    expect(run(lapThree(timing, lapsOver)).projections[carId(0)]).toEqual({
      carId: carId(0),
      onLap: false,
      projectedLapMs: notApplicable,
      deltaToBestMs: notApplicable,
      projectedPosition: notApplicable,
      // one car leaves no cut-off position; the cut-off on an out lap is in "lap-times cut-off"
      cutOff: notApplicable,
      finishMarginMs: notApplicable,
    });
  });

  it.each(['flyingLap', 'onTrack'] as const)('a car on a %s lap is on a lap', (driverStatus) => {
    const p = run(lapThree({ driverStatus })).projections[carId(0)]!;
    expect(p.onLap).toBe(true);
    expect(p.projectedLapMs).toMatchObject({ known: true, value: 90_000 });
  });

  it('without a valid best lap or a crossing in the current lap the projection is insufficientData', () => {
    // lap 1 in progress: no completed lap yet
    const first = lapInProgress(0, 1, 90_000, 0, 10);
    const noBest = run(scene({ miniSectors: first, cars: activeCars(1, { 0: { lap: 1, driverStatus: 'flyingLap' } }), sessionTime: first[first.length - 1]!.at }));
    // lap 3 just started but its start line is not recorded yet: the newest crossing belongs to lap 2
    const { laps, miniSectors: all } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    const miniSectors = all.filter((m) => m.lap <= 2);
    const noCrossing = run(scene({ laps, miniSectors, cars: activeCars(1, { 0: { lap: 3, driverStatus: 'flyingLap' } }), sessionTime: 180_000 }));
    for (const out of [noBest, noCrossing]) {
      const p = out.projections[carId(0)]!;
      expect(p.onLap).toBe(true);
      expect(p.projectedLapMs).toEqual(insufficientData);
      expect(p.deltaToBestMs).toEqual(insufficientData);
      expect(p.projectedPosition).toEqual(insufficientData);
      expect(p.finishMarginMs).toEqual(insufficientData);
    }
  });
});

describe('lap-times cut-off', () => {
  /**
   * `cars` active cars with best laps of 90.0, 90.1, 90.2 … s (two laps each) in a session of `classified` cars
   * (`session.numActiveCars`, default `cars`); `subject` is on lap 3, `upMs` up on its best at crossing 25, so it
   * projects its best − `upMs`.
   */
  const quali = ({
    cars,
    classified = cars,
    subject = cars - 1,
    upMs,
    session = Q1,
    config = {},
    timing = { driverStatus: 'flyingLap' },
    noBest = false,
  }: {
    cars: number;
    classified?: number;
    subject?: number;
    upMs: number;
    session?: { sessionType: number; kind: 'practice' | 'qualifying' | 'sprintShootout' | 'race' | 'timeTrial' };
    config?: Record<string, Record<string, number>>;
    /** The subject's timing on lap 3. */
    timing?: Partial<CarTiming>;
    /** The subject has no lap yet: lap 3 is its first flying lap. */
    noBest?: boolean;
  }) => {
    const paces = Array.from({ length: cars }, (_, i) => 90_000 + 100 * i);
    const { laps: all, miniSectors } = field({ cars, laps: 2, paceMs: paces });
    const laps = noBest ? all.filter((l) => l.carId !== carId(subject)) : all;
    const pace = paces[subject]!;
    const live = lapInProgress(subject, 3, pace, 2 * pace, 25, upMs);
    const sessionTime = live[live.length - 1]!.at;
    const view = scene({
      laps,
      miniSectors: [...miniSectors, ...live],
      cars: activeCars(cars, { [subject]: { lap: 3, ...timing } }),
      session: { ...session, numActiveCars: classified },
      sessionTime,
      config,
    });
    return { p: run(view).projections[carId(subject)]!, sessionTime, projected: pace - upMs };
  };

  it("Q1, 20 cars: cut-off is P15's best lap; margin positive when we are inside", () => {
    // car 19 (P20 on 91.9 s) projects 91.0 s; P15 is car 14 on 91.4 s
    const inside = quali({ cars: 20, upMs: 900 });
    expect(inside.p.projectedLapMs).toEqual(known(91_000, inside.sessionTime));
    expect(inside.p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: known(400, inside.sessionTime) }, inside.sessionTime));
    // projecting 91.6 s it would be out by 0.2 s
    const outside = quali({ cars: 20, upMs: 300 });
    expect(outside.p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: known(-200, outside.sessionTime) }, outside.sessionTime));
  });

  it('the cut-off time leaves the car itself out: for the fastest car it is the 15th fastest of the others', () => {
    // car 0 (90.0 s) projects 89.7 s; the others are cars 1..19, the 15th fastest of them car 15 on 91.5 s
    const { p, sessionTime } = quali({ cars: 20, subject: 0, upMs: 300 });
    expect(p.cutOff).toEqual(known({ position: 15, timeMs: 91_500, marginMs: known(1_800, sessionTime) }, sessionTime));
  });

  it.each([
    ['Q1', 5, 'qualifying', 20, 15],
    ['Sprint Shootout 1', 10, 'sprintShootout', 20, 15],
    ['Q2', 6, 'qualifying', 20, 10],
    ['Sprint Shootout 2', 11, 'sprintShootout', 20, 10],
  ] as const)('%s, %s: classified cars − eliminated so far is the cut-off position', (_, sessionType, kind, cars, position) => {
    const { p, projected } = quali({ cars, upMs: 900, session: { sessionType, kind } });
    // the subject is the slowest car, so the P-th fastest of the others is car P − 1
    const timeMs = 90_000 + 100 * (position - 1);
    expect(p.cutOff).toMatchObject({ known: true, value: { position, timeMs, marginMs: { known: true, value: timeMs - projected } } });
  });

  it('Q2 counts the cars knocked out in Q1: 20 classified, 15 still active, cut-off P10', () => {
    // cars 0..14 run; car 14 (best 91.4 s) projects 90.5 s; P10 of the others is car 9 on 90.9 s
    const { p, sessionTime } = quali({ cars: 15, classified: 20, upMs: 900, session: { sessionType: 6, kind: 'qualifying' } });
    expect(p.cutOff).toEqual(known({ position: 10, timeMs: 90_900, marginMs: known(400, sessionTime) }, sessionTime));
  });

  it('on an out lap the cut-off still stands, from the others\' bests; only the margin is notApplicable', () => {
    // P15 of the others is car 14 on 91.4 s; known since the newest of the others' bests: car 18's lap 1, at 91.8 s
    const { p } = quali({ cars: 20, upMs: 900, timing: { driverStatus: 'outLap' } });
    expect(p.onLap).toBe(false);
    expect(p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: notApplicable }, 91_800));
  });

  it('on the first flying lap (no best of its own) the cut-off stands; the margin is insufficientData', () => {
    const { p } = quali({ cars: 20, upMs: 900, noBest: true });
    expect(p.onLap).toBe(true);
    expect(p.projectedLapMs).toEqual(insufficientData);
    expect(p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: insufficientData }, 91_800));
  });

  it('the eliminated counts come from the config', () => {
    const config = { [LAP_TIMES_CONFIG.key]: { eliminatedQ1: 6, eliminatedQ2: 4 } };
    const q1 = quali({ cars: 20, upMs: 900, config });
    expect(q1.p.cutOff).toMatchObject({ known: true, value: { position: 14, timeMs: 91_300 } });
    // in Q2 F1 25 counts only the cars still in qualifying (numActiveCars 14 after 6 went out in Q1): 14 − 4
    const q2 = quali({ cars: 14, upMs: 900, config, session: { sessionType: 6, kind: 'qualifying' } });
    expect(q2.p.cutOff).toMatchObject({ known: true, value: { position: 10, timeMs: 90_900 } });
  });

  it.each([
    ['Q3', 7, 'qualifying'],
    ['Sprint Shootout 3', 12, 'sprintShootout'],
    ['Short Qualifying', 8, 'qualifying'],
    ['One-Shot Qualifying', 9, 'qualifying'],
    ['Short Sprint Shootout', 13, 'sprintShootout'],
    ['One-Shot Sprint Shootout', 14, 'sprintShootout'],
    ['practice', 1, 'practice'],
    ['the race', 15, 'race'],
  ] as const)('no cut-off in %s (session type %s)', (_, sessionType, kind) => {
    const { p } = quali({ cars: 20, upMs: 900, session: { sessionType, kind } });
    expect(p.onLap).toBe(true);
    expect(p.cutOff).toEqual(notApplicable);
  });
});

describe('lap-times finish margin', () => {
  /** Car 0 on lap 3 at crossing 25 (45 s into a 90 s best lap): 45 s of the projected lap remain. */
  const atCrossing25 = (session: { sessionType: number; kind: 'practice' | 'qualifying' | 'race' | 'timeTrial' }, timeLeftMs: number) => {
    const { laps, miniSectors } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    const live = lapInProgress(0, 3, 90_000, 180_000, 25);
    const sessionTime = live[live.length - 1]!.at; // 225 000
    const cars = activeCars(1, { 0: { lap: 3, driverStatus: 'flyingLap', currentLapTimeMs: 45_000 } });
    const view = scene({ laps, miniSectors: [...miniSectors, ...live], cars, session: { ...session, timeLeftMs, updatedAt: sessionTime }, sessionTime });
    return { p: run(view).projections[carId(0)]!, sessionTime };
  };

  it('timed session, 60 s left, 45 s of the projected lap remaining: finishMarginMs 15 000', () => {
    const { p, sessionTime } = atCrossing25(PRACTICE, 60_000);
    expect(p.projectedLapMs).toEqual(known(90_000, sessionTime));
    expect(p.finishMarginMs).toEqual(known(15_000, sessionTime));
  });

  it('negative when the clock runs out before the car reaches the line', () => {
    const { p, sessionTime } = atCrossing25(Q1, 30_000);
    expect(p.finishMarginMs).toEqual(known(-15_000, sessionTime));
  });

  it.each([
    ['the race', RACE],
    ['time trial', { sessionType: 18, kind: 'timeTrial' } as const],
  ])('no finish margin in %s', (_, session) => {
    expect(atCrossing25(session, 60_000).p.finishMarginMs).toEqual(notApplicable);
  });
});
