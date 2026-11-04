// Pit stops beyond the main cases (stints-pit-stops.test.ts): the flag, the pit-lane times and the change tag of a box stop
// (contract C10, C26; migration Task 17). Ported from the pit-stop block of test/history/history-edge-cases.test.ts onto
// the activity spans: the race is under way from the first frame (lap 2), so its activity opens racingLap there, and the
// visit is inLap, boxStop, outLap. The rows of the served-penalty marks by DTSV/SGSV/FTLP/OVTK events during the visit
// (`RecorderInput.tracked`) are deleted with their mechanism; served penalties are pinned in stints-pit-stops.test.ts.
import { describe, expect, it } from 'vitest';
import { situationOf } from '../../src/situations/run.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;

describe('pit stops', () => {
  /**
   * t = 0, 1000 (entry), 2000 (box), 3000 (exit); `before` is queued ahead of the entry frame. `underWay` (default): the
   * race is under way from frame 0 (lap 2); otherwise it stands on the grid (lap 1, the lap timer 0).
   */
  const visit = (o: { before?: (b: ScenarioBuilder) => void; laneTimes?: boolean; underWay?: boolean } = {}) => {
    const lap = o.underWay === false ? {} : { currentLapNum: 2 };
    const b = new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, (d) => Object.assign(car0(d), lap));
    o.before?.(b);
    b.frames(1, (d) => Object.assign(car0(d), { ...lap, pitStatus: 1, ...(o.laneTimes && { pitLaneTimeInLaneInMs: 500 }) }));
    b.frames(1, (d) => Object.assign(car0(d), { ...lap, pitStatus: 2, ...(o.laneTimes && { pitLaneTimeInLaneInMs: 1_800, pitStopTimerInMs: 900 }) }));
    return runScenario(b.frames(1, (d) => Object.assign(car0(d), { ...lap, pitStatus: 0, pitLaneTimeInLaneInMs: 0, pitStopTimerInMs: 0 })));
  };

  it.each([
    ['a virtual safety car', 2, 'vsc'],
    ['a safety car', 1, 'sc'],
    ['green', 0, 'green'],
  ] as const)('a stop under %s is flagged %s', (_, safetyCarStatus, flag) => {
    const { st } = visit({ before: (b) => b.session({ safetyCarStatus }) });
    expect(st.history.pitStops).toMatchObject([{ flag }]);
  });
  it('a box visit during the formation lap is no pit stop: no car has an activity before lights out, so the log holds none (C29)', () => {
    const { st } = visit({ underWay: false, before: (b) => b.session({ safetyCarStatus: 3 }) });
    expect(situationOf(st).byMachine['session-phase-race']?.map((s) => s.kind)).toEqual(['formation']);
    expect(situationOf(st).byMachine['car-activity-race'] ?? []).toEqual([]);
    expect(st.log.pitStops).toEqual([]);
  });
  it('without a pit lane timer from the game, the pit lane time is how long the car was seen in the pit lane', () => {
    const { st } = visit();
    expect(st.history.pitStops).toMatchObject([{ pitLaneEntry: 1_000, pitLaneExit: 3_000, pitLaneTimeMs: 2_000, stationaryTimeMs: 0 }]);
  });
  it('with a pit lane timer from the game, that time wins', () => {
    const { st } = visit({ laneTimes: true });
    expect(st.history.pitStops).toMatchObject([{ pitLaneTimeMs: 1_800, stationaryTimeMs: 900 }]);
  });
  it('tags pitStops on the frame the car leaves the pit lane and on no other', () => {
    const { results } = visit();
    expect(results.map((r) => r.changed.has('pitStops'))).toEqual([false, false, false, true]);
  });
});
