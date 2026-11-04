// `lap-times` (spec 6.2): the projection part of the calculator output, per car.
import { carId, known, unknown, type LapRecord, type WeekendPhase } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { field } from '../../../../test-support/builders/index.ts';
import { LAP_TIMES_CONFIG } from '../../src/lap-times/index.ts';
import { activeCars, lapInProgress, NONE, PENDING, PRACTICE, Q1, Q2, Q3, RACE, SS1, SS2, run, scene, type CarKinds } from './scene.ts';

const notApplicable = unknown('notApplicable');
const insufficientData = unknown('insufficientData');

describe('lap-times projection', () => {
  it("projection at crossing 25 of a lap 0.3 s up on the best lap's crossing 25 projects best − 300 ms", () => {
    // 3 cars with best laps of 90.0, 89.8 and 89.6 s; car 0 starts lap 3 at 180 s and is 0.3 s up at crossing 25
    const { laps, crossings: miniSectors } = field({ cars: 3, laps: 2, paceMs: [90_000, 89_800, 89_600] });
    const live = lapInProgress(0, 3, 90_000, 180_000, 25, 300);
    const latest = live[live.length - 1]!.at; // 180 000 + 45 000 − 300
    const cars = activeCars(3, { 0: { lap: 3, currentLapTimeMs: latest - 180_000 } });
    const out = run(scene({ laps, miniSectors: [...miniSectors, ...live], cars, phase: RACE, sessionTime: latest }));

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

  /** A car's lap 3 crossings up to crossing 25 after two laps at 90 s, in `phase` with the subject's spans `kinds`. */
  const lapThree = (kinds: CarKinds, { phase = Q1, lapsOver = {} }: { phase?: WeekendPhase; lapsOver?: Partial<LapRecord> } = {}) => {
    const { laps, crossings: miniSectors } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    Object.assign(laps[1]!, lapsOver); // lap 2
    const live = lapInProgress(0, 3, 90_000, 180_000, 25);
    const sessionTime = live[live.length - 1]!.at;
    return scene({ laps, miniSectors: [...miniSectors, ...live], cars: activeCars(1, { 0: { lap: 3 } }), phase, kinds: { 0: kinds }, sessionTime });
  };

  const NOT_ON_LAP = {
    carId: carId(0),
    onLap: false,
    projectedLapMs: notApplicable,
    deltaToBestMs: notApplicable,
    projectedPosition: notApplicable,
    // one car leaves no cut-off position; the cut-off on an out lap is in "lap-times cut-off"
    cutOff: notApplicable,
    finishMarginMs: notApplicable,
  };
  const projected = (view: ReturnType<typeof lapThree>) => run(view).projections[carId(0)]!;
  const onLap = (p: ReturnType<typeof projected>) => {
    expect(p.onLap).toBe(true);
    expect(p.projectedLapMs).toMatchObject({ known: true, value: 90_000 });
  };

  // One test per row of the behaviour table (C44): car-activity of each phase, car-location, car-status, weekend-phase.
  describe('row car-activity-race', () => {
    const race = (activity: string, location = 'track') => lapThree({ activity, location }, { phase: RACE });
    it.each(['racingLap', 'servingPenalty'])('%s: on a lap, projected', (activity) => onLap(projected(race(activity))));
    it.each(['inLap', 'outLap', 'finished', 'coolDown'])('%s: no projection (onLap false, notApplicable)', (activity) => {
      expect(projected(race(activity))).toEqual(NOT_ON_LAP);
    });
    it('boxStop (in the pit lane): no projection', () => expect(projected(race('boxStop', 'pitLane'))).toEqual(NOT_ON_LAP));
    it('notCompeting (its status retired): not projected, on its lap, will not come', () => {
      const p = projected(lapThree({ activity: 'notCompeting', status: 'retired' }, { phase: RACE }));
      expect(p).toMatchObject({ onLap: true, projectedLapMs: notApplicable, deltaToBestMs: notApplicable, projectedPosition: notApplicable, finishMarginMs: notApplicable });
    });
  });

  describe('row car-activity-qualifying', () => {
    const quali = (activity: string) => lapThree({ activity }, { phase: Q1 });
    it('pushLap: on a lap, projected', () => onLap(projected(quali('pushLap'))));
    it.each(['outLap', 'inLap', 'garage', 'finished'])('%s: no projection (onLap false, notApplicable)', (activity) => {
      expect(projected(quali(activity))).toEqual(NOT_ON_LAP);
    });
    it('notCompeting (its status disqualified): not projected, on its lap, will not come', () => {
      const p = projected(lapThree({ activity: 'notCompeting', status: 'disqualified' }, { phase: Q1 }));
      expect(p).toMatchObject({ onLap: true, projectedLapMs: notApplicable, projectedPosition: notApplicable });
    });
  });

  describe('row car-activity-practice', () => {
    const practice = (activity: string) => lapThree({ activity }, { phase: PRACTICE });
    it('flyingLap: on a lap, projected', () => onLap(projected(practice('flyingLap'))));
    it.each(['outLap', 'inLap', 'garage', 'finished'])('%s: no projection (onLap false, notApplicable)', (activity) => {
      expect(projected(practice(activity))).toEqual(NOT_ON_LAP);
    });
    it('notCompeting (its status retired): not projected, on its lap, will not come', () => {
      const p = projected(lapThree({ activity: 'notCompeting', status: 'retired' }, { phase: PRACTICE }));
      expect(p).toMatchObject({ onLap: true, projectedLapMs: notApplicable, projectedPosition: notApplicable });
    });
  });

  describe('row car-location', () => {
    it.each(['garage', 'pitLane'])('%s: no projection (onLap false), on a lap activity too', (location) => {
      expect(projected(lapThree({ location }))).toEqual(NOT_ON_LAP);
    });
    it('track: projected', () => onLap(projected(lapThree({ location: 'track' }))));
  });

  describe('row car-status', () => {
    it.each(['retired', 'disqualified'])('%s: not projected, on its lap, will not come (notApplicable)', (status) => {
      const p = projected(lapThree({ status }));
      expect(p).toMatchObject({ onLap: true, projectedLapMs: notApplicable, deltaToBestMs: notApplicable, projectedPosition: notApplicable, finishMarginMs: notApplicable });
    });
    // Task 24 (C13): the result status left the live state; car-status's span is the one input
    it('competing: projected', () => {
      onLap(projected(lapThree({ status: 'competing' })));
    });
    it('absent: no projection at all', () => expect(run(lapThree({ status: 'absent' })).projections[carId(0)]).toBeUndefined());
  });

  it('the lap after an in lap has no projection (the lap record says it follows an in lap)', () => {
    expect(projected(lapThree({}, { lapsOver: { inLap: true } }))).toEqual(NOT_ON_LAP);
  });

  describe('row weekend-phase', () => {
    it.each([
      ['practice', PRACTICE],
      ['qualifying', Q1],
      ['race', RACE],
    ])('%s: projected on its lap activity', (_, phase) => onLap(projected(lapThree({}, { phase }))));
    it('none (a time trial or an unknown session type): notApplicable, no projection for any car', () => {
      expect(projected(lapThree({}, { phase: NONE }))).toEqual(NOT_ON_LAP);
    });
    it('pending (no phase span yet): the phase is not decided, nothing is projected (insufficientData would invent a lap)', () => {
      const p = projected(lapThree({}, { phase: PENDING }));
      expect(p.onLap).toBe(false);
      expect(p.projectedLapMs).toEqual(notApplicable);
      expect(p.cutOff).toEqual(notApplicable);
    });
  });

  it('without a valid best lap or a crossing in the current lap the projection is insufficientData', () => {
    // lap 1 in progress: no completed lap yet
    const first = lapInProgress(0, 1, 90_000, 0, 10);
    const noBest = run(scene({ miniSectors: first, cars: activeCars(1, { 0: { lap: 1 } }), sessionTime: first[first.length - 1]!.at }));
    // lap 3 just started but its start line is not recorded yet: the newest crossing belongs to lap 2
    const { laps, crossings: all } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    const miniSectors = all.filter((m) => m.lap <= 2);
    const noCrossing = run(scene({ laps, miniSectors, cars: activeCars(1, { 0: { lap: 3 } }), sessionTime: 180_000 }));
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
   * `cars` cars in the session with best laps of 90.0, 90.1, 90.2 … s (two laps each) and `absent` more that left the
   * session (car-status absent: the cars knocked out earlier, with the best laps of the fastest ones, which never count);
   * `subject` is on lap 3, `upMs` up on its best at crossing 25, so it projects its best − `upMs`.
   */
  const quali = ({
    cars,
    absent = 0,
    subject = cars - 1,
    upMs,
    phase = Q1,
    config = {},
    kinds = {},
    noBest = false,
  }: {
    cars: number;
    absent?: number;
    subject?: number;
    upMs: number;
    phase?: WeekendPhase;
    config?: Record<string, Record<string, number>>;
    /** The subject's span kinds on lap 3. */
    kinds?: CarKinds;
    /** The subject has no lap yet: lap 3 is its first flying lap. */
    noBest?: boolean;
  }) => {
    const total = cars + absent;
    const paces = Array.from({ length: total }, (_, i) => 90_000 + 100 * i);
    const { laps: all, crossings: miniSectors } = field({ cars: total, laps: 2, paceMs: paces });
    const laps = noBest ? all.filter((l) => l.carId !== carId(subject)) : all;
    const pace = paces[subject]!;
    const live = lapInProgress(subject, 3, pace, 2 * pace, 25, upMs);
    const sessionTime = live[live.length - 1]!.at;
    // the absent cars are the last slots: their (slow) bests are in the history and must not count either
    const absentKinds = Object.fromEntries(Array.from({ length: absent }, (_, i) => [cars + i, { status: 'absent' }]));
    const view = scene({
      laps,
      miniSectors: [...miniSectors, ...live],
      cars: activeCars(total, { [subject]: { lap: 3 } }),
      phase,
      kinds: { ...absentKinds, [subject]: kinds },
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

  // The elimination counts come from the weekend phase's segment and format, not from session type codes (C14): the live
  // session of these views stays a race (session type 15).
  it.each([
    ['Q1', Q1, 20, 15],
    ['Sprint Shootout 1', SS1, 20, 15],
    // in the second part only the 15 cars still in it count
    ['Q2', Q2, 15, 10],
    ['Sprint Shootout 2', SS2, 15, 10],
  ] as const)('row weekend-phase qualifying, %s: the cars in this part − the cars it knocks out is the cut-off position', (_, phase, cars, position) => {
    const { p, projected } = quali({ cars, upMs: 900, phase });
    // the subject is the slowest car, so the P-th fastest of the others is car P − 1
    const timeMs = 90_000 + 100 * (position - 1);
    expect(p.cutOff).toMatchObject({ known: true, value: { position, timeMs, marginMs: { known: true, value: timeMs - projected } } });
  });

  it('Q2 counts only the cars still in it: 20 slots, 5 absent (knocked out), cut-off P10, and the absent cars\' bests do not count', () => {
    // cars 0..14 run; car 14 (best 91.4 s) projects 90.5 s; P10 of the others is car 9 on 90.9 s
    const { p, sessionTime } = quali({ cars: 15, absent: 5, upMs: 900, phase: Q2 });
    expect(p.cutOff).toEqual(known({ position: 10, timeMs: 90_900, marginMs: known(400, sessionTime) }, sessionTime));
  });

  it('the eliminated counts come from the config', () => {
    const config = { [LAP_TIMES_CONFIG.key]: { eliminatedQ1: 6, eliminatedQ2: 4 } };
    const q1 = quali({ cars: 20, upMs: 900, config });
    expect(q1.p.cutOff).toMatchObject({ known: true, value: { position: 14, timeMs: 91_300 } });
    // in Q2 the 14 cars still in qualifying (6 went out in Q1): 14 − 4
    const q2 = quali({ cars: 14, upMs: 900, config, phase: Q2 });
    expect(q2.p.cutOff).toMatchObject({ known: true, value: { position: 10, timeMs: 90_900 } });
  });

  it('on an out lap the cut-off still stands, from the others\' bests; only the margin is notApplicable', () => {
    // P15 of the others is car 14 on 91.4 s; known since the newest of the others' bests: car 18's lap 1, at 91.8 s
    const { p } = quali({ cars: 20, upMs: 900, kinds: { activity: 'outLap' } });
    expect(p.onLap).toBe(false);
    expect(p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: notApplicable }, 91_800));
  });

  it('on the first flying lap (no best of its own) the cut-off stands; the margin is insufficientData', () => {
    const { p } = quali({ cars: 20, upMs: 900, noBest: true });
    expect(p.onLap).toBe(true);
    expect(p.projectedLapMs).toEqual(insufficientData);
    expect(p.cutOff).toEqual(known({ position: 15, timeMs: 91_400, marginMs: insufficientData }, 91_800));
  });

  it.each([
    ['Q3', Q3],
    ['Sprint Shootout 3', { kind: 'qualifying', format: 'sprintShootout', segment: 3 }],
    ['Short Qualifying', { kind: 'qualifying', format: 'short', segment: undefined }],
    ['One-Shot Qualifying', { kind: 'qualifying', format: 'oneShot', segment: undefined }],
    ['Short Sprint Shootout', { kind: 'qualifying', format: 'shortSprintShootout', segment: undefined }],
    ['One-Shot Sprint Shootout', { kind: 'qualifying', format: 'oneShotSprintShootout', segment: undefined }],
    ['practice', PRACTICE],
    ['the race', RACE],
  ] as const)('no cut-off in %s', (_, phase) => {
    const { p } = quali({ cars: 20, upMs: 900, phase: phase as WeekendPhase });
    expect(p.onLap).toBe(true);
    expect(p.cutOff).toEqual(notApplicable);
  });
});

describe('lap-times finish margin', () => {
  /** Car 0 on lap 3 at crossing 25 (45 s into a 90 s best lap): 45 s of the projected lap remain. */
  const atCrossing25 = (phase: WeekendPhase, timeLeftMs: number) => {
    const { laps, crossings: miniSectors } = field({ cars: 1, laps: 2, paceMs: 90_000 });
    const live = lapInProgress(0, 3, 90_000, 180_000, 25);
    const sessionTime = live[live.length - 1]!.at; // 225 000
    const cars = activeCars(1, { 0: { lap: 3, currentLapTimeMs: 45_000 } });
    const view = scene({ laps, miniSectors: [...miniSectors, ...live], cars, phase, session: { timeLeftMs, updatedAt: sessionTime }, sessionTime });
    return { p: run(view).projections[carId(0)]!, sessionTime };
  };

  it('row weekend-phase practice: 60 s left, 45 s of the projected lap remaining: finishMarginMs 15 000', () => {
    const { p, sessionTime } = atCrossing25(PRACTICE, 60_000);
    expect(p.projectedLapMs).toEqual(known(90_000, sessionTime));
    expect(p.finishMarginMs).toEqual(known(15_000, sessionTime));
  });

  it('row weekend-phase qualifying: negative when the clock runs out before the car reaches the line', () => {
    const { p, sessionTime } = atCrossing25(Q1, 30_000);
    expect(p.finishMarginMs).toEqual(known(-15_000, sessionTime));
  });

  it.each([
    ['the race', RACE],
    ['none (a time trial)', NONE],
  ])('row weekend-phase %s: no finish margin', (_, phase) => {
    expect(atCrossing25(phase, 60_000).p.finishMarginMs).toEqual(notApplicable);
  });
});
