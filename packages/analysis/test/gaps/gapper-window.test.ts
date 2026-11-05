// The gapper's window and its points per mini-sector (live polish spec 3.2, plan Task 3). `GapperLines.cars` holds only
// the window: our cars, plus every car within ±`windowMs` (10 000) of one of ours; a car in it leaves only beyond
// ±(`windowMs` + `windowExitMs`) (11 000). Entering and leaving are judged at each crossing, on the gap between the two
// cars' gapper lines at a point both passed: the time between their crossings of it, the same for every reference (the
// reference is the topic's param, the fold over the crossings cannot know it, C31.2). Each line has `points`: one per
// crossing for the last `fineLaps` (10) completed laps and the current one, one per completed lap before them, at
// x = completed laps + segment / 50; `points` replaces the per-lap `byLap`, which is no longer written. `now` is unchanged.
import { carId, feedId, known, MINI_SECTORS, unknown, type MiniSectorCrossing } from '@pitwall/domain';
import { SessionRunner, situationOf, type EngineView, type Frame, type StepResult } from '@pitwall/engine';
import { describe, expect, it } from 'vitest';
import { ScenarioBuilder } from '../../../engine/test/builders/index.ts';
import { expectIncrementalEqualsFromScratch, IDLE_FEED } from '../../../engine/test/helpers/incremental.ts';
import { openNeutralisation } from '../../../../test-support/builders/index.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { gapperLines } from '../../src/gaps/gaps.ts';
import { GAPS_CONFIG, type GapperReference } from '../../src/gaps/index.ts';
import { byTime, carsFor, deltaOf, gaps, guarded, offsetRace, plain, pointsByProgress, progressOf, run, viewOf, windowOf } from './race.ts';

/** Every car laps in 90 s here: a mini-sector every 1.8 s. */
const SEGMENT_MS = 1_800;
/** The reference at the cars' pace: a car's gapper value is minus its delay, constant while it keeps the pace. */
const FIXED: GapperReference = { kind: 'fixed', lapMs: 90_000 };
const REFERENCES: GapperReference[] = [FIXED, { kind: 'fixed', lapMs: 80_000 }, { kind: 'fixed', lapMs: 100_000 }, { kind: 'leaderAverage' }];

/**
 * Car `car`'s crossings from progress 0 (at `startAt`) up to progress `upTo`: each mini-sector 1.8 s plus `extra(p)` for
 * the one that ends at progress p (negative: faster).
 */
function track(car: number, startAt: number, upTo: number, extra: (p: number) => number = () => 0): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  let at = startAt;
  for (let p = 0; p <= upTo; p++) {
    if (p > 0) at += SEGMENT_MS + extra(p);
    list.push({ carId: carId(car), lap: Math.floor(p / MINI_SECTORS) + 1, segment: p % MINI_SECTORS, at, frame: 0 });
  }
  return list;
}

/** The window of the gapper over these crossings (player car 0 unless `playerCar` says otherwise). */
const windowFor = (ms: MiniSectorCrossing[], over: Parameters<typeof viewOf>[1] = {}, reference: GapperReference = FIXED): number[] =>
  windowOf(gapperLines(run(viewOf(ms, over)), reference));

describe('the gapper window: our cars', () => {
  it('our cars are always in it, the teammate too, however far they are from every other car', () => {
    // car 0 (the player) leads; car 1 is 30 s behind it; car 2 is 60 s behind car 0 and 30 s behind car 1
    const ms = offsetRace([0, 30_000, 60_000], 3);
    expect(windowFor(ms)).toEqual([0]);
    expect(windowFor(ms, { teammateCar: 2 })).toEqual([0, 2]);
    expect(windowFor(ms, { playerCar: 1 })).toEqual([1]);
  });

  it('our car is in it before its first crossing, with no point and no live point', () => {
    // cars 0 and 1 have run a lap; car 2, the player, has no crossing yet
    const ms = offsetRace([0, 1_000], 1);
    const lines = gapperLines(run(viewOf(ms, { cars: carsFor(ms, { 2: { position: 3 } }), playerCar: 2 })), FIXED);
    expect(windowOf(lines)).toEqual([2]);
    expect(lines.cars.find((c) => c.carId === carId(2))).toMatchObject({ points: [], now: unknown('notApplicable') });
  });

  it('follows a player car change with no new crossing: update equals init (C31.3)', () => {
    // car 1 is 5 s behind car 0, car 2 30 s behind car 0 and 25 s behind car 1
    const ms = offsetRace([0, 5_000, 30_000], 2);
    const first = viewOf(ms);
    const acc = gaps.init(guarded(first));
    expect(windowOf(gapperLines(gaps.output(acc), FIXED))).toEqual([0, 1]);
    const next = viewOf(ms, { playerCar: 2 });
    const out = gaps.output(gaps.update(acc, deltaOf(first, next), guarded(next)));
    expect(out).toEqual(run(next));
    expect(windowOf(gapperLines(out, FIXED))).toEqual([2]);
  });
});

describe('the gapper points', () => {
  /**
   * Car 0 (the player) and car 1, 2 s behind it, lap in 90 s for 16 laps; cut at 1 386 000, where car 0 is at progress
   * 770 (lap 16, mini-sector 20: 15 laps completed, x = 15.4) and car 1 at progress 768.
   */
  const midLap = () => offsetRace([0, 2_000], 16).filter((m) => m.at <= 1_386_000);
  /** At the reference 89 s a mini-sector gains 1 780 − 1 800: car 0's gap at progress p is −20 p, car 1's −20 p − 2 000. */
  const at89: GapperReference = { kind: 'fixed', lapMs: 89_000 };
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  it('one point per crossing for the last 10 completed laps and the current one, one per completed lap before them', () => {
    const lines = gapperLines(run(viewOf(midLap())), at89);
    // car 0: laps 1 to 5 at their line (progress 50 … 250), then every crossing from progress 251 (x 5.02) to 770 (x 15.4)
    const car0 = [...[1, 2, 3, 4, 5].map((l) => l * MINI_SECTORS), ...range(251, 770)];
    expect(pointsByProgress(lines, 0)).toEqual(car0.map((p) => [p, plain(-20 * p)]));
    // car 1 has completed 15 laps as well: the same split, up to its newest crossing at progress 768
    const car1 = [...[1, 2, 3, 4, 5].map((l) => l * MINI_SECTORS), ...range(251, 768)];
    expect(pointsByProgress(lines, 1)).toEqual(car1.map((p) => [p, -20 * p - 2_000]));
  });

  it('x is completed laps + segment / 50', () => {
    const lines = gapperLines(run(viewOf(midLap())), at89);
    const xs = lines.cars.find((c) => c.carId === carId(0))?.points.map((p) => p.lap) ?? [];
    expect(xs.slice(0, 6)).toEqual([1, 2, 3, 4, 5, 5 + 1 / MINI_SECTORS].map((x) => expect.closeTo(x, 9)));
    expect(xs.at(-1)).toBeCloseTo(15 + 20 / MINI_SECTORS, 9);
    // every point lies on a crossing: x × 50 is a whole number of mini-sectors
    for (const x of xs) expect(Math.abs(x * MINI_SECTORS - Math.round(x * MINI_SECTORS))).toBeLessThan(1e-6);
  });

  it('at the line: 500 points per crossing for the 10 laps just completed, one per lap before', () => {
    // car 0 has just completed lap 15 at progress 750 (x = 15)
    const lines = gapperLines(run(viewOf(offsetRace([0, 2_000], 16).filter((m) => m.at <= 1_350_000))), at89);
    const points = pointsByProgress(lines, 0) ?? [];
    expect(points.map(([p]) => p)).toEqual([...[1, 2, 3, 4, 5].map((l) => l * MINI_SECTORS), ...range(251, 750)]);
    expect(points.filter(([p]) => p > 250)).toHaveLength(10 * MINI_SECTORS);
  });

  it('a race shorter than 10 laps has a point at every crossing', () => {
    const lines = gapperLines(run(viewOf(offsetRace([0, 2_000], 3))), at89);
    // the start line (x = 0, at lights out) is not pinned
    expect(pointsByProgress(lines, 0)?.filter(([p]) => p > 0)).toEqual(range(1, 150).map((p) => [p, plain(-20 * p)]));
  });

  it('uses fineLaps from the config', () => {
    const lines = gapperLines(run(viewOf(midLap(), { config: { [GAPS_CONFIG.key]: { fineLaps: 2 } } })), at89);
    // 15 laps completed: laps 1 to 13 at their line, every crossing after x = 13
    expect(pointsByProgress(lines, 0)?.map(([p]) => p)).toEqual([...range(1, 13).map((l) => l * MINI_SECTORS), ...range(651, 770)]);
  });

  it('writes no byLap: the per-lap gaps are the points at the lines', () => {
    const lines = gapperLines(run(viewOf(midLap())), at89);
    expect(lines.cars.length).toBeGreaterThan(0);
    for (const car of lines.cars) expect(car, `car ${car.carId}`).not.toHaveProperty('byLap');
  });

  it('a car without a known race start or reference lap has no point', () => {
    const noStart = gapperLines(run(viewOf(midLap(), { lightsOutAt: null })), FIXED);
    expect(noStart.cars.map((c) => c.points)).toEqual(noStart.cars.map(() => []));
    // every crossing lies before the lights go out at 60 s: the leader average is insufficientData
    const early = offsetRace([0, 2_000], 1).filter((m) => m.at < 50_000);
    const noReference = gapperLines(run(viewOf(early, { lightsOutAt: 60_000 })), { kind: 'leaderAverage' });
    expect(noReference.cars.map((c) => c.points)).toEqual(noReference.cars.map(() => []));
  });
});

describe("the gapper's live point (now) beside the points", () => {
  const at89: GapperReference = { kind: 'fixed', lapMs: 89_000 };

  it('is unchanged: the gap at the newest crossing, the same as the last point', () => {
    const ms = offsetRace([0, 2_000], 16).filter((m) => m.at <= 1_386_000);
    const car0 = gapperLines(run(viewOf(ms)), at89).cars.find((c) => c.carId === carId(0));
    // 15.4 × 89 000 − 1 386 000
    expect(car0?.now).toEqual(known({ lap: expect.closeTo(15.4, 9), gapMs: -15_400 }, 1_386_000));
    const last = car0?.points.at(-1);
    expect(last?.lap).toBeCloseTo(15.4, 9);
    expect(last?.gapMs).toBe(-15_400);
  });

  it('is notApplicable at the line, where the last point is the completed lap', () => {
    const ms = offsetRace([0, 2_000], 16).filter((m) => m.at <= 1_350_000);
    const car0 = gapperLines(run(viewOf(ms)), at89).cars.find((c) => c.carId === carId(0));
    expect(car0?.now).toEqual(unknown('notApplicable'));
    expect(car0?.points.at(-1)).toEqual({ lap: 15, gapMs: -15_000 });
  });
});

describe('the gapper window: entering', () => {
  it('a car exactly 10 000 ms behind one of ours enters; 10 001 ms does not', () => {
    expect(windowFor(offsetRace([0, 10_000], 3))).toEqual([0, 1]);
    expect(windowFor(offsetRace([0, 10_001], 3))).toEqual([0]);
  });

  it('a car exactly 10 000 ms ahead of one of ours enters; 10 001 ms does not', () => {
    expect(windowFor(offsetRace([0, 10_000], 3), { playerCar: 1 })).toEqual([0, 1]);
    expect(windowFor(offsetRace([0, 10_001], 3), { playerCar: 1 })).toEqual([1]);
  });

  it('a car within 10 s of the teammate enters, however far it is from the player', () => {
    // car 1 is 40 s behind the player (car 0) and 8 s ahead of the teammate (car 2)
    expect(windowFor(offsetRace([0, 40_000, 48_000], 3), { teammateCar: 2 })).toEqual([0, 1, 2]);
  });

  it('uses windowMs from the config', () => {
    const config = { [GAPS_CONFIG.key]: { windowMs: 5_000 } };
    expect(windowFor(offsetRace([0, 5_000], 2), { config })).toEqual([0, 1]);
    expect(windowFor(offsetRace([0, 5_001], 2), { config })).toEqual([0]);
  });
});

describe('the gapper window: leaving', () => {
  /** Car 1 starts 5 s behind car 0 (in the window) and loses `lossMs` in the mini-sector that ends at progress 60. */
  const losing = (lossMs: number) => byTime([...track(0, 0, 150), ...track(1, 5_000, 150, (p) => (p === 60 ? lossMs : 0))]);

  it('a car in the window stays at 11 000 ms and leaves at 11 001 ms', () => {
    expect(windowFor(losing(6_000))).toEqual([0, 1]);
    expect(windowFor(losing(6_001))).toEqual([0]);
  });

  it('a car that left re-enters only within 10 000 ms again', () => {
    // car 1 falls to 12 s behind at progress 60, then gains back 1.5 s by progress 90, then 2 s by progress 120
    const back = (regainMs: number) =>
      byTime([...track(0, 0, 150), ...track(1, 5_000, 150, (p) => (p === 60 ? 7_000 : p === 90 ? -1_500 : p === 120 ? -regainMs : 0))]);
    // at 10.5 s it stays out
    expect(windowFor(back(0))).toEqual([0]);
    // at 10 s it is back in
    expect(windowFor(back(500))).toEqual([0, 1]);
  });

  it('uses windowExitMs from the config', () => {
    const config = { [GAPS_CONFIG.key]: { windowExitMs: 3_000 } };
    expect(windowFor(losing(8_000), { config })).toEqual([0, 1]);
    expect(windowFor(losing(8_001), { config })).toEqual([0]);
  });
});

describe('the gapper window: judged at each crossing', () => {
  it('a car that came within 10 s at one crossing is in, though its gap at the newest crossing is 10.5 s', () => {
    // car 1 starts 12 s behind, gains 150 ms a mini-sector from progress 41 to 60 (down to 9 s, within 10 s from
    // progress 54), then loses 150 ms a mini-sector up to progress 70 (10.5 s), and keeps that gap
    const ms = byTime([...track(0, 0, 150), ...track(1, 12_000, 150, (p) => (p > 40 && p <= 60 ? -150 : p > 60 && p <= 70 ? 150 : 0))]);
    // all crossings at once (init) and crossing by crossing (update) agree
    expect(windowFor(ms)).toEqual([0, 1]);
    const empty = viewOf([]);
    let state = gaps.init(guarded(empty));
    let view = empty;
    for (let n = 1; n <= ms.length; n++) {
      const next = viewOf(ms.slice(0, n));
      state = gaps.update(state, deltaOf(view, next), guarded(next));
      view = next;
    }
    expect(windowOf(gapperLines(gaps.output(state), FIXED))).toEqual([0, 1]);
  });

  it('a car that passes through 9 s between two crossings without a crossing there does not enter', () => {
    // car 1 leads, car 0 (the player) follows 10.5 s behind, both at 90 s: at every point both passed their gap is
    // 10.5 s. Against a virtual car at 80 s the newest points lie 9.3 s apart between crossings (car 1 at progress 111,
    // 199 800, car 0 at progress 105, 199 500): no crossing has them within 10 s
    const ms = offsetRace([10_500, 0], 3).filter((m) => m.at <= 200_000);
    expect(progressOf(ms.findLast((m) => m.carId === carId(1))!)).toBe(111);
    expect(progressOf(ms.findLast((m) => m.carId === carId(0))!)).toBe(105);
    for (const reference of REFERENCES) expect(windowFor(ms, {}, reference), JSON.stringify(reference)).toEqual([0]);
  });

  it('is the same for every reference: the gap between two lines at a point both passed', () => {
    // up to 230 000: car 0 at progress 127, car 1 at 122 (9 s behind, then 40 ms a mini-sector slower from progress
    // 101: 9.88 s), car 2 at 121 (14 s behind, 40 ms a mini-sector faster from progress 51: 11.16 s, never within 10 s).
    // Against a virtual car at 80 s the newest points of cars 0 and 2 lie 9.96 s apart; at 90 s 11.16 s
    const ms = byTime([...track(0, 0, 150), ...track(1, 9_000, 150, (p) => (p > 100 ? 40 : 0)), ...track(2, 14_000, 150, (p) => (p > 50 ? -40 : 0))]).filter(
      (m) => m.at <= 230_000,
    );
    const out = run(viewOf(ms));
    for (const reference of REFERENCES) expect(windowOf(gapperLines(out, reference)), JSON.stringify(reference)).toEqual([0, 1]);
  });
});

describe('the gapper window after a flashback', () => {
  // car 0 (the player) laps in 90 s from 0. Car 1 starts 12 s behind and gains 150 ms a mini-sector from progress 61 to
  // 90: within 10 s from progress 74. An SC is out from 100 s on, through the flashback (Review Focus 4).
  const sc = openNeutralisation({ kind: 'SC', start: 100_000 });
  const original = byTime([...track(0, 0, 150), ...track(1, 12_000, 150, (p) => (p > 60 && p <= 90 ? -150 : 0))]);

  it('a car that entered after the target is not in the window of the rewound run: update equals a fresh run', () => {
    // the flashback goes back to 128 300, when car 1 had passed progress 65 at 11.25 s; on the new timeline it keeps that gap
    const target = 128_300;
    const kept = original.filter((m) => m.at <= target);
    const replayed = byTime([...track(0, 0, 150), ...track(1, 12_000, 150, (p) => (p > 60 && p <= 65 ? -150 : 0))]).filter((m) => m.at > target);
    const full = viewOf(original, { open: sc });
    const back = viewOf(byTime([...kept, ...replayed]), { open: sc });
    const acc = gaps.init(guarded(full));
    expect(windowOf(gapperLines(gaps.output(acc), FIXED))).toEqual([0, 1]);
    const out = gaps.output(gaps.update(acc, deltaOf(full, back, true), guarded(back)));
    expect(out).toEqual(run(back));
    expect(windowOf(gapperLines(out, FIXED))).toEqual([0]);
  });

  it('a car that entered before the target stays in it on the new timeline at 10.65 s: update equals a fresh run', () => {
    // the flashback goes back to 150 000, when car 1 had passed progress 78 at 9.3 s; it then loses 1.35 s by progress 87
    const target = 150_000;
    const kept = original.filter((m) => m.at <= target);
    const replayed = byTime([...track(0, 0, 150), ...track(1, 12_000, 150, (p) => (p > 60 && p <= 78 ? -150 : p > 78 && p <= 87 ? 150 : 0))]).filter((m) => m.at > target);
    const full = viewOf(original, { open: sc });
    const back = viewOf(byTime([...kept, ...replayed]), { open: sc });
    const out = gaps.output(gaps.update(gaps.init(guarded(full)), deltaOf(full, back, true), guarded(back)));
    expect(out).toEqual(run(back));
    expect(windowOf(gapperLines(out, FIXED))).toEqual([0, 1]);
  });
});

// The engine's own frames: a 5 000 m track, a frame a second. Car 0 (the player) drives 50 m a frame (a 100 s lap) from
// lights out at frame 6; car 1, the teammate (team 0 with car 0), from frame 46, 40 s behind. Car 2 starts at frame 18,
// 12 s behind car 0, and from frame 70 drives 60 m a frame: its gap is 12 − 0.2 (frame − 70) s, within 10 s from frame
// 80. An SC is deployed at frame 40 and confirmed at 42. The run rewinds at frame 88 (gap 8.4 s) to frame 79 (10.2 s),
// within the runner's replay window: on the new timeline car 2 drives 50 m a frame again and keeps 10.2 s.
describe('the gapper window over engine frames with a flashback (C31.3, Review Focus 4)', () => {
  const STEP_MS = 1_000;
  const LENGTH_M = 5_000;
  const TARGET = 79;
  const REWIND_AT = 88;
  const END = 110;
  const at100: GapperReference = { kind: 'fixed', lapMs: 100_000 };

  const car2Original = (i: number) => (i <= 18 ? 0 : i <= 70 ? (i - 18) * 50 : 2_600 + (i - 70) * 60);
  const car2Replayed = (i: number) => (i <= TARGET ? car2Original(i) : car2Original(TARGET) + (i - TARGET) * 50);
  const distances = (i: number, car2: (i: number) => number) => [Math.max(0, i - 6) * 50, Math.max(0, i - 46) * 50, car2(i)];

  /** Frames 0 … count − 1, car 2 driven by `car2`; an FLBK to `flashbackTo` in the frame after it. */
  function timeline(count: number, car2: (i: number) => number, flashbackTo?: number): Frame[] {
    const b = new ScenarioBuilder({ cars: 3, stepMs: STEP_MS });
    for (let i = 0; i < count; i++) {
      if (i >= 1 && i <= 5) b.event({ code: 'STLG', numLights: i });
      if (i === 6) b.event({ code: 'LGOT' });
      if (i === 40) b.event({ code: 'SCAR', safetyCarType: 1, eventType: 0 });
      if (i === 42) b.session({ safetyCarStatus: 1 });
      if (flashbackTo !== undefined && i === flashbackTo + 1) {
        b.event({ code: 'FLBK', flashbackFrameIdentifier: flashbackTo, flashbackSessionTime: (flashbackTo * STEP_MS) / 1000 });
      }
      const totals = distances(i, car2);
      const order = [0, 1, 2].sort((a, c) => totals[c]! - totals[a]! || a - c);
      b.frame((d) =>
        totals.forEach((total, k) =>
          Object.assign(d.lapData.lapData[k]!, {
            currentLapNum: Math.floor(total / LENGTH_M) + 1,
            lapDistance: total % LENGTH_M,
            totalDistance: total,
            carPosition: order.indexOf(k) + 1,
          }),
        ),
      );
    }
    return b.build();
  }

  /** The original timeline up to frame 87, then the new one from frame 80 (its overall frame ids keep rising). */
  const original = () => timeline(REWIND_AT, car2Original);
  const rewound = (): Frame[] => {
    const before = original();
    const after = timeline(END, car2Replayed, TARGET).slice(TARGET + 1);
    return [...before, ...after.map((f, i) => ({ ...f, overallFrameId: before.length + i }))];
  };

  /** The gapper window after the last frame, from a fresh `init` over that step's view. */
  function lastWindow(frames: readonly Frame[]): number[] {
    const first = frames.find((f) => f.session !== undefined);
    if (first?.session === undefined) throw new Error('no frame carries a session');
    const runner = new SessionRunner({ feedId: feedId('test'), sessionUid: first.sessionUid, session: first.session });
    let window: number[] = [];
    const record = ({ state, changed, delta }: StepResult) => {
      const view: EngineView = { live: state, situation: situationOf(state), history: state.history, changed, delta, weekend: state.weekend, feed: IDLE_FEED, config: {}, priors: {}, track: unknown('notApplicable'), outputs: new Map() };
      window = windowOf(gapperLines(gapsCalculator.output(gapsCalculator.init(view), view), at100));
    };
    for (const frame of frames) runner.apply(frame, record);
    runner.end(record);
    return window;
  }

  it('car 2 is in the window before the flashback and out of it after: the window of the new timeline', () => {
    expect(lastWindow(original())).toEqual([0, 1, 2]);
    expect(lastWindow(rewound())).toEqual([0, 1]);
  });

  it('incremental equals from scratch at every frame, across the flashback', () => {
    expectIncrementalEqualsFromScratch(gapsCalculator, rewound());
  });
});
