// t = 0, 1000, 2000, …; leader = car 0 on lap 3
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';

const race = () => new ScenarioBuilder({ cars: 2, stepMs: 1000 }).frames(1, (d) => { d.lapData.lapData[0]!.currentLapNum = 3; });
const noop = () => {};
const scar = (eventType: number): EventDetails => ({ code: 'SCAR', safetyCarType: 1, eventType });

describe('flag phases', () => {
  it('open on a safety-car status transition, close when it clears, with leader laps', () => {
    const { st, results } = runScenario(race().session({ safetyCarStatus: 1 }).frames(1, noop)            // 1000
      .frames(1, (d) => { d.lapData.lapData[0]!.currentLapNum = 4; })                                     // 2000
      .session({ safetyCarStatus: 0 }).frames(1, noop));                                                  // 3000
    expect(st.history.flagPhases).toEqual([{ kind: 'SC', start: 1000, end: 3000, startLeaderLap: 3, endLeaderLap: 4, scPhases: [] }]);
    expect(results.map((r) => r.changed.has('flagPhases'))).toEqual([false, false, false, true]);
  });
  it('SCAR deployed opens early; returning/returned are recorded; resume closes', () => {
    const { st } = runScenario(race().event(scar(0)).frames(1, noop)                                        // 1000 deployed
      .session({ safetyCarStatus: 1 }).frames(1, noop)                                                    // 2000 status follows: no 2nd phase
      .event(scar(1)).frames(1, noop).event(scar(2)).frames(1, noop).event(scar(3)).frames(1, noop)       // 3000, 4000, 5000
      .session({ safetyCarStatus: 0 }).frames(1, noop));                                                  // 6000 already closed
    expect(st.history.flagPhases).toEqual([{ kind: 'SC', start: 1000, end: 5000, startLeaderLap: 3, endLeaderLap: 3, scPhases: [
      { phase: 'deployed', at: 1000 }, { phase: 'returning', at: 3000 }, { phase: 'returned', at: 4000 }, { phase: 'resume', at: 5000 }] }]);
  });
  it('VSC = status 2; SC -> VSC switches phases; formation lap (3) is ignored', () => {
    const { st } = runScenario(race().session({ safetyCarStatus: 3 }).frames(1, noop).session({ safetyCarStatus: 1 }).frames(1, noop)
      .session({ safetyCarStatus: 2 }).frames(1, noop).session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(st.history.flagPhases.map((p) => [p.kind, p.start, p.end])).toEqual([['SC', 2000, 3000], ['VSC', 3000, 4000]]);
  });
  it('red flag: RDFL opens, the next lights out closes', () => {
    const { st } = runScenario(race().event({ code: 'RDFL' }).frames(2, noop).event({ code: 'LGOT' }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'red', start: 1000, end: 3000, startLeaderLap: 3 }]);
  });
  it('red flag: a restart behind the safety car closes it', () => {
    const { st } = runScenario(race().event({ code: 'RDFL' }).frames(1, noop).session({ safetyCarStatus: 1 }).frames(1, noop));
    expect(st.history.flagPhases).toMatchObject([{ kind: 'red', start: 1000, end: 2000, startLeaderLap: 3 }]);
  });
  it('red flag: SEND closes it', () => {
    const { st } = runScenario(race().event({ code: 'RDFL' }).frames(2, noop).event({ code: 'SEND' }));   // SEND joins the 2000 frame
    expect(st.history.flagPhases).toMatchObject([{ kind: 'red', start: 1000, end: 2000 }]);
  });
  it('SEND closes an open phase', () => {
    const { st } = runScenario(race().session({ safetyCarStatus: 2 }).frames(2, noop).event({ code: 'SEND' }));   // SEND joins the 2000 frame
    expect(st.history.flagPhases).toMatchObject([{ kind: 'VSC', start: 1000, end: 2000 }]);
  });
});
