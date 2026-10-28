// Pit stops, flag phases and mini-sector crossings beyond the main cases: guards, defaults and change tags.
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const noop = () => {};

describe('pit stops', () => {
  const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
  // t = 0, 1000 (entry), 2000, 3000 (exit); `before` is queued ahead of the entry frame
  const visit = (o: { before?: (b: ScenarioBuilder) => void; during?: EventDetails; laneTimes?: boolean } = {}) => {
    const b = new ScenarioBuilder({ cars: 1, stepMs: 1000 }).frames(1, noop);
    o.before?.(b);
    b.frames(1, (d) => Object.assign(car0(d), { pitStatus: 1, ...(o.laneTimes && { pitLaneTimeInLaneInMs: 500 }) }));
    if (o.during) b.event(o.during);
    b.frames(1, (d) => Object.assign(car0(d), { pitStatus: 2, ...(o.laneTimes && { pitLaneTimeInLaneInMs: 1_800, pitStopTimerInMs: 900 }) }));
    return runScenario(b.frames(1, (d) => Object.assign(car0(d), { pitStatus: 0, pitLaneTimeInLaneInMs: 0, pitStopTimerInMs: 0 })));
  };

  it.each([
    ['a virtual safety car', 2, 'vsc'],
    ['a safety car', 1, 'sc'],
    ['the formation lap', 3, 'green'],
    ['green', 0, 'green'],
  ] as const)('a stop under %s is flagged %s', (_, safetyCarStatus, flag) => {
    const { st } = visit({ before: (b) => b.session({ safetyCarStatus }) });
    expect(st.history.pitStops).toMatchObject([{ flag }]);
  });
  it('without a pit lane timer from the game, the pit lane time is how long the car was seen in the pit lane', () => {
    const { st } = visit();
    expect(st.history.pitStops).toMatchObject([{ pitLaneEntry: 1_000, pitLaneExit: 3_000, pitLaneTimeMs: 2_000, stationaryTimeMs: 0 }]);
  });
  it('with a pit lane timer from the game, that time wins', () => {
    const { st } = visit({ laneTimes: true });
    expect(st.history.pitStops).toMatchObject([{ pitLaneTimeMs: 1_800, stationaryTimeMs: 900 }]);
  });
  it.each([
    ['a drive-through', { code: 'DTSV', vehicleIdx: 0 }, true],
    ['a stop-go', { code: 'SGSV', vehicleIdx: 0, stopTime: 10 }, true],
    ['the car’s fastest lap', { code: 'FTLP', vehicleIdx: 0, lapTime: 80 }, false],
    ['an overtake by the car', { code: 'OVTK', overtakingVehicleIdx: 0, beingOvertakenVehicleIdx: 1 }, false],
  ] as const)('%s during the visit: penalty served = %s', (_, during, penaltyServed) => {
    const { st } = visit({ during });
    expect(st.history.pitStops).toMatchObject([{ penaltyServed }]);
  });
  it('tags pitStops on the frame the car leaves the pit lane and on no other', () => {
    const { results } = visit();
    expect(results.map((r) => r.changed.has('pitStops'))).toEqual([false, false, false, true]);
  });
});

describe('flag phases', () => {
  const rows = (cars: ReadonlyArray<{ position: number; lap: number; resultStatus?: number }>) =>
    new ScenarioBuilder({ cars: cars.length, stepMs: 1000 }).frames(1, (d) => {
      cars.forEach((c, i) => Object.assign(d.lapData.lapData[i]!, { carPosition: c.position, currentLapNum: c.lap, resultStatus: c.resultStatus ?? 2 }));
    });
  const scar = (safetyCarType: number, eventType: number): EventDetails => ({ code: 'SCAR', safetyCarType, eventType });

  it('the leader lap is the lap of the car in first place', () => {
    const { st } = runScenario(rows([{ position: 2, lap: 3 }, { position: 1, lap: 5 }]).session({ safetyCarStatus: 1 }).frames(1, noop).session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'SC', startLeaderLap: 5, endLeaderLap: 5 }]);
  });
  it('a car in first place that is not in the session is not the leader', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 9, resultStatus: 1 }, { position: 1, lap: 5 }, { position: 2, lap: 4 }])
      .session({ safetyCarStatus: 1 }).frames(1, noop).session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ startLeaderLap: 5 }]);
  });
  it('without a leader in the session the leader lap is 0', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 9, resultStatus: 1 }, { position: 2, lap: 4 }]).session({ safetyCarStatus: 1 }).frames(1, noop)
      .session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ startLeaderLap: 0, endLeaderLap: 0 }]);
  });

  describe('safety car events', () => {
    const phases = (...events: EventDetails[]) => {
      const b = rows([{ position: 1, lap: 1 }]);
      for (const e of events) b.event(e).frames(1, noop);
      return runScenario(b.event({ code: 'SEND' }).frames(1, noop)).st.history.flagPhases;
    };
    it.each([
      ['no safety car', scar(0, 0)],
      ['the formation lap safety car', scar(3, 0)],
      ['a safety car type the game does not have', scar(7, 0)],
    ])('%s: a deployment opens no phase', (_, event) => {
      expect(phases(event)).toEqual([]);
    });
    it('a return or a resume without a deployment opens no phase', () => {
      expect(phases(scar(1, 1), scar(1, 2), scar(1, 3))).toEqual([]);
    });
    it('an event phase the game does not have is not recorded', () => {
      expect(phases(scar(1, 0), scar(1, 9))).toMatchObject([{ kind: 'SC', scPhases: [{ phase: 'deployed', at: 1000 }] }]);
    });
    it('an event of the other kind is not recorded in the open phase', () => {
      expect(phases(scar(1, 0), scar(2, 1))).toMatchObject([{ kind: 'SC', scPhases: [{ phase: 'deployed', at: 1000 }] }]);
    });
  });

  it('lights out does not end a safety car phase', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).session({ safetyCarStatus: 1 }).frames(1, noop).event({ code: 'LGOT' }).frames(1, noop)
      .session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'SC', start: 1000, end: 3000 }]);
  });
  it('the safety car going away does not end a red flag phase', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).session({ safetyCarStatus: 1 }).frames(1, noop).event({ code: 'RDFL' }).frames(1, noop)
      .session({ safetyCarStatus: 0 }).frames(1, noop).event({ code: 'LGOT' }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'SC', start: 1000, end: 2000 }, { kind: 'red', start: 2000, end: 4000 }]);
  });
  it('the formation lap status does not end a red flag phase', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).event({ code: 'RDFL' }).frames(1, noop).session({ safetyCarStatus: 3 }).frames(1, noop)
      .event({ code: 'LGOT' }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'red', start: 1000, end: 3000 }]);
  });
});

describe('mini-sector crossings', () => {
  // trackLength 5000 m → 50 segments of 100 m; frames every 100 ms
  const crossings = (samples: ReadonlyArray<readonly [lap: number, distance: number]>, session: { trackLength?: number } = {}) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 100 }).session(session).frames(samples.length, (d) => {
      Object.assign(d.lapData.lapData[0]!, { currentLapNum: samples[d.index]![0], lapDistance: samples[d.index]![1] });
    }));
    return { found: st.history.miniSectors.map(({ lap, segment, at }) => [lap, segment, at]), results };
  };

  it('a lap wrap also crosses the boundaries that were left on the old lap', () => {
    expect(crossings([[3, 4850], [4, 150]]).found).toEqual([[3, 49, 17], [4, 0, 50], [4, 1, 83]]);
  });
  it('a car first seen on a boundary has not crossed it', () => {
    expect(crossings([[3, 4900], [4, 150]]).found).toEqual([[4, 0, 40], [4, 1, 80]]);
  });
  it('a car that arrives on a boundary has crossed it', () => {
    expect(crossings([[3, 4950], [4, 100]]).found).toEqual([[4, 0, 33], [4, 1, 100]]);
  });
  it('a lap wrap with no time between the samples crosses the line when it was first seen', () => {
    expect(crossings([[3, 5000], [4, 0]]).found).toEqual([[4, 0, 0]]);
  });
  it('a lap that starts on a negative lap distance does not carry the last segment of the old lap into the new one', () => {
    expect(crossings([[3, 4850], [3, 4950], [4, -30], [4, 20]]).found).toEqual([[3, 49, 50], [4, 0, 260]]);
  });
  it('a track without a length has no crossings', () => {
    expect(crossings([[1, -10], [1, 10]], { trackLength: 0 }).found).toEqual([]);
  });
  it('tags miniSectors on the frames with a crossing and on no other', () => {
    expect(crossings([[1, 950], [1, 1250], [1, 1260]]).results.map((r) => r.changed.has('miniSectors'))).toEqual([false, true, false]);
  });
});
