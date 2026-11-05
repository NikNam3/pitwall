// A garage restart on the same lap number (practice, qualifying, a sprint shootout): the game does not advance the lap
// number through the garage, so the lap restarts at the line where the car's timed activity opens its push span after
// the out lap (`lapStepOf` gives `restart`, the laps recorder's rule). The mini-sector recorder restarts the lap there
// too: the restart frame appends the restarted lap's line crossing (segment 0, interpolated at the line), and every
// boundary of the lap is crossed again from it. A crossing of a (car, lap, segment) the lap already recorded names the
// earlier one it supersedes (C25: both stay in the log). The recorder keeps the positions of the current lap's newest
// crossings in its own open state (C10), part of every snapshot (C27); a race never restarts (contract C10, C11, C21,
// C24, C25, C26, C27; live-test fixes Task 2).
import { describe, expect, it } from 'vitest';
import { MINI_SECTORS, type FactRef, type MiniSectorCrossing } from '@pitwall/domain';
import { initialState, SessionRunner, situationOf, step, type DeepReadonly, type EngineState, type Frame } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { gridStart, lap, LIGHTS_OUT, run, script, STEP, type Beat } from '../situations/script.ts';
import { GARAGE_VISIT } from '../situations/car-activity-timed/behaviour.ts';
import { initFor, runFrames } from '../support/run.ts';
import { after, runAll } from '../support/runner.ts';

const DRIVER_STATUS = { inGarage: 0, flyingLap: 1, inLap: 2, outLap: 3, onTrack: 4 } as const;
const PIT_STATUS = { none: 0, pitting: 1, inPitArea: 2 } as const;
const TRACK_M = 5_000;
const ALL_SEGMENTS = Array.from({ length: MINI_SECTORS }, (_, s) => s);

type Row = (typeof GARAGE_VISIT)[number];
/**
 * The garage visit of `car-activity-timed/garage-restart.test.ts` one lap earlier: the engine joins at the end of lap 1,
 * lap 2 begins at frame 1; the in lap, the pit lane (passing the line at frame 4), the garage and the out lap stay on
 * lap 2; the out lap reaches the line at frame 11 (the push span opens there, frame number 12) and the game times lap 2
 * from it; lap 3 begins at frame 14.
 */
const LAP2_VISIT: readonly Row[] = GARAGE_VISIT.map(([lapNumber, ...rest]) => [lapNumber - 1, ...rest] as Row);
/** The index of the frame the restarted lap 2 starts on (the push span opens on its frame number, index + 1). */
const RESTART = 11;
const restartFrame = RESTART + 1;

/** `rows` as frames of a session of type `sessionType` on a 5000 m track, one frame per second, car 0 alone. */
const frames = (sessionType: number, rows: readonly Row[]): Frame[] =>
  new ScenarioBuilder({ cars: 1, stepMs: 1000 })
    .session({ sessionType, trackLength: TRACK_M })
    .frames(rows.length, (d) => {
      const [lapNumber, lapDistance, currentLapTimeInMs, ps, ds] = rows[d.index]!;
      Object.assign(d.lapData.lapData[0]!, { currentLapNum: lapNumber, lapDistance, currentLapTimeInMs, pitStatus: PIT_STATUS[ps], driverStatus: DRIVER_STATUS[ds] });
    })
    .build();

/** Car 0's crossings of the projection, each with its position in the projection's list (its fact id, no formation here). */
const crossingsOf = (st: DeepReadonly<EngineState>) =>
  st.history.crossings.flatMap((c, index) => (c.carId === 0 ? [{ c, ref: { list: 'crossings', index } as FactRef }] : []));

/** The spans of sub-machine `machine` for car 0, closed and open. */
const spansOf = (st: DeepReadonly<EngineState>, machine: string) =>
  [...(st.history.spans[machine] ?? []), ...(situationOf(st).byMachine[machine] ?? [])].filter((s) => s.carId === 0);

/**
 * Every fact ref to a crossing that the mini-sector recorder's own open state holds, by its position; crossings it keeps
 * whole (a kept line crossing) are not looked into.
 */
const refsInOwn = (st: DeepReadonly<EngineState>): number[] => {
  const found: number[] = [];
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    const o = value as Record<string, unknown>;
    if (o['list'] === 'crossings' && typeof o['index'] === 'number') {
      found.push(o['index']);
      return;
    }
    if ('carId' in o && 'segment' in o && 'lap' in o) return;
    for (const v of Array.isArray(value) ? value : Object.values(o)) walk(v);
  };
  walk(st.open.recorders['miniSectors']);
  return found.sort((a, b) => a - b);
};

describe('mini-sector crossings restart with the lap at a garage restart', () => {
  it('a garage restart records the flying lap’s crossings again: every segment of lap 2, each superseding the earlier crossing of lap 2 and that segment', () => {
    const { st } = runFrames(frames(1, LAP2_VISIT));
    const lap2 = crossingsOf(st).filter(({ c }) => c.lap === 2);
    const earlier = lap2.filter(({ c }) => c.frame < restartFrame);
    const again = lap2.filter(({ c }) => c.frame >= restartFrame);
    // the earlier pass crossed every boundary of lap 2 before the pit lane
    expect(earlier.map(({ c }) => c.segment)).toEqual(ALL_SEGMENTS);
    expect(again.map(({ c }) => c.segment)).toEqual(ALL_SEGMENTS);
    for (const { c } of again) {
      const before = earlier.find((e) => e.c.segment === c.segment)!;
      expect(c.supersedes).toEqual(before.ref);
    }
    expect(earlier.every(({ c }) => c.supersedes === undefined)).toBe(true);
  });

  it('the first segment of the restarted lap is the line: the restart frame appends (lap 2, segment 0) interpolated at the line', () => {
    const fs = frames(1, LAP2_VISIT);
    const { st } = runFrames(fs);
    // frame 10 at 4950 m, frame 11 at 3 m: the line lies 50 m of the 53 m between them
    const [t10, t11] = [fs[RESTART - 1]!.sessionTime, fs[RESTART]!.sessionTime];
    const earlierLine = crossingsOf(st).find(({ c }) => c.lap === 2 && c.segment === 0 && c.frame < restartFrame)!;
    expect(crossingsOf(st).filter(({ c }) => c.frame === restartFrame).map(({ c }) => c)).toEqual([
      { carId: 0, lap: 2, segment: 0, at: Math.round(t10 + ((t11 - t10) * 50) / 53), frame: restartFrame, supersedes: earlierLine.ref },
    ]);
  });

  it('segments the earlier pass never reached get no supersedes (the engine joined lap 2 at 2400 m)', () => {
    // joined mid lap 2, then the garage visit from its in lap on: the earlier pass crosses segments 25 to 49 only
    const rows: Row[] = [[2, 2_400, 44_000, 'none', 'flyingLap'], ...LAP2_VISIT.slice(2)];
    // one frame fewer before the restart: it is at index RESTART - 1, frame number RESTART
    const restart = RESTART;
    const { st } = runFrames(frames(1, rows));
    const lap2 = crossingsOf(st).filter(({ c }) => c.lap === 2);
    const earlier = lap2.filter(({ c }) => c.frame < restart);
    const again = lap2.filter(({ c }) => c.frame >= restart);
    expect(earlier.map(({ c }) => c.segment)).toEqual(ALL_SEGMENTS.slice(25));
    expect(again.map(({ c }) => c.segment)).toEqual(ALL_SEGMENTS);
    expect(again.filter(({ c }) => c.segment < 25).map(({ c }) => c.supersedes)).toEqual(Array.from({ length: 25 }, () => undefined));
    expect(again.filter(({ c }) => c.segment >= 25).map(({ c }) => c.supersedes)).toEqual(earlier.map(({ ref }) => ref));
  });

  it.each([['qualifying', 5], ['a sprint shootout', 10]])('%s restarts the same way (the qualifying activity’s push kind)', (_, sessionType) => {
    const { st } = runFrames(frames(sessionType, LAP2_VISIT));
    expect(spansOf(st, 'car-activity-qualifying').find((s) => s.kind === 'pushLap' && s.startFrame === restartFrame)).toBeDefined();
    const lap2 = crossingsOf(st).filter(({ c }) => c.lap === 2);
    const earlier = lap2.filter(({ c }) => c.frame < restartFrame);
    const again = lap2.filter(({ c }) => c.frame >= restartFrame);
    expect(again.map(({ c }) => [c.segment, c.supersedes])).toEqual(earlier.map(({ c, ref: r }) => [c.segment, r]));
    expect(again.map(({ c }) => c.segment)).toEqual(ALL_SEGMENTS);
  });

  it('a race never restarts: the same-lap wrap at the flag keeps its one line crossing (lap + 1, segment 0) and nothing supersedes', () => {
    // after the lights out car 0 drives lap 1, crosses into lap 2, and takes the flag at a wrap on lap 2 (race frame 6),
    // the lap number staying 2; it cools down after
    const ROWS: Array<[lapNumber: number, distanceM: number, resultStatus: number]> = [
      [1, 10, 2], [1, 2_000, 2], [1, 3_950, 2], [2, 20, 2], [2, 2_000, 2], [2, 3_950, 2], [2, 5, 3], [2, 500, 3], [2, 1_000, 3],
    ];
    const FLAG = 6;
    const race = (k: number): Beat => ({
      cars: (d: FrameDraft) => {
        const row = ROWS[Math.min(k, ROWS.length - 1)]!;
        lap(d, 0, { currentLapNum: row[0], lapDistance: row[1], resultStatus: row[2], currentLapTimeInMs: 1_000 + k * STEP });
      },
    });
    const { runner } = run(script(gridStart(ROWS.length, race)));
    // race frame k is the frame after the lights out plus k; its frame number one more than its index
    const flagFrame = LIGHTS_OUT + 1 + FLAG + 1;
    expect(runner.state.history.spans['car-activity-race']?.find((s) => s.carId === 0 && s.kind === 'finished')).toMatchObject({ startFrame: flagFrame });
    const mine = runner.state.history.crossings.filter((c) => c.carId === 0);
    expect(mine.filter((c) => c.lap === 3 && c.segment === 0).map((c) => c.frame)).toEqual([flagFrame]);
    expect(mine.filter((c) => c.supersedes !== undefined)).toEqual([]);
    const keys = mine.map((c) => `${c.lap}:${c.segment}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a flashback across the restart gives the crossings a straight run gives (every supersedes included)', () => {
    // the game rewinds from frame 13 to frame 9, the out lap; the new timeline's out lap reaches 4900 m, not 4950 m, at frame 10
    const original = frames(1, LAP2_VISIT);
    const forkRows = LAP2_VISIT.map((row, i) => (i === RESTART - 1 ? ([row[0], 4_900, row[2], row[3], row[4]] as Row) : row));
    const fork = frames(1, forkRows);
    const runner = new SessionRunner(initFor(original));
    runAll(runner, original.slice(0, RESTART + 3));
    const results = runAll(runner, after(fork, RESTART - 1, RESTART + 3));
    expect(results[0]!.delta.rewound).toBeDefined();
    const straight = new SessionRunner(initFor(fork));
    runAll(straight, fork);
    expect(straight.state.history.crossings.some((c) => c.supersedes !== undefined)).toBe(true);
    expect(runner.state.history.crossings).toEqual(straight.state.history.crossings);
  });

  it('a push span on a new lap number appends no extra segment 0: one (lap 3, segment 0), no supersedes', () => {
    // the pit lane ends before the line: the out lap reaches the line at frame 9 as the lap number goes up to 3
    const rows: Row[] = [
      [1, 4_900, 88_000, 'none', 'flyingLap'],
      [2, 5, 100, 'none', 'flyingLap'],
      [2, 2_500, 45_000, 'none', 'inLap'],
      [2, 4_800, 85_000, 'pitting', 'inLap'],
      [2, 4_850, 86_000, 'pitting', 'inLap'],
      [2, 4_860, 88_000, 'pitting', 'inGarage'],
      [2, 4_860, 89_000, 'pitting', 'inGarage'],
      [2, 4_860, 90_000, 'pitting', 'outLap'],
      [2, 4_900, 97_000, 'none', 'outLap'],
      [3, 3, 50, 'none', 'outLap'],
      [3, 2_500, 45_000, 'none', 'flyingLap'],
      [3, 4_900, 89_000, 'none', 'flyingLap'],
      [4, 5, 100, 'none', 'flyingLap'],
    ];
    const line = 9 + 1;
    const { st } = runFrames(frames(1, rows));
    expect(spansOf(st, 'car-activity-practice').find((s) => s.kind === 'flyingLap' && s.startFrame === line && s.joinedAt === undefined)).toBeDefined();
    const mine = crossingsOf(st).map(({ c }) => c);
    expect(mine.filter((c) => c.lap === 3 && c.segment === 0).map((c) => c.frame)).toEqual([line]);
    expect(mine.filter((c) => c.supersedes !== undefined)).toEqual([]);
  });

  it('the open state holds the current lap only: the newest crossing of each segment of the lap, at most 50 per car', () => {
    const fs = frames(1, LAP2_VISIT);
    const st = initialState(initFor(fs));
    const seen: number[][] = [];
    for (const f of fs) {
      step(st, f);
      seen.push(refsInOwn(st));
    }
    for (const refs of seen) expect(refs.length).toBeLessThanOrEqual(MINI_SECTORS);
    const positions = (pick: (c: DeepReadonly<MiniSectorCrossing>) => boolean) =>
      crossingsOf(st).filter(({ c }) => pick(c)).map(({ ref: r }) => r.index);
    // before lap 3: the restarted pass of lap 2, every segment's newest crossing
    expect(seen[13]).toHaveLength(MINI_SECTORS);
    expect(seen[13]).toEqual(positions((c) => c.lap === 2 && c.frame >= restartFrame));
    // after lap 3 began: no ref of lap 2 is kept
    expect(seen[15]).toEqual(positions((c) => c.lap === 3));
    expect(seen[15]!.length).toBeGreaterThan(0);
  });
});
