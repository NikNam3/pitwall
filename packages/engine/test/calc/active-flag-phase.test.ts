import { describe, expect, it } from 'vitest';
import { activeFlagPhaseOf } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';
import { input, quick, sched } from '../support/scheduler.ts';

const race = () => new ScenarioBuilder({ cars: 2, stepMs: 1000 }).frames(1, (d) => { d.lapData.lapData[0]!.currentLapNum = 3; });
const noop = () => {};

describe('activeFlagPhaseOf', () => {
  it('is the open safety-car phase with its start and kind, and undefined once it closed', () => {
    const open = runScenario(race().session({ safetyCarStatus: 1 }).frames(2, noop)).st;
    expect(activeFlagPhaseOf(open)).toMatchObject({ kind: 'SC', start: 1000, startLeaderLap: 3 });
    expect(open.history.flagPhases).toEqual([]);

    const closed = runScenario(race().session({ safetyCarStatus: 1 }).frames(1, noop).session({ safetyCarStatus: 0 }).frames(1, noop)).st;
    expect(activeFlagPhaseOf(closed)).toBeUndefined();
    expect(closed.history.flagPhases).toMatchObject([{ kind: 'SC', start: 1000 }]);
  });
});

describe('the view a calculator receives', () => {
  it('carries the active flag phase of the scheduler input', () => {
    const seen: unknown[] = [];
    const s = sched([quick('probe', { compute: (v) => { seen.push(v.activeFlagPhase); return 0; } })]);
    const phase = { kind: 'SC', start: 1000, startLeaderLap: 3, scPhases: [] } as const;
    s.run({ ...input(1000), activeFlagPhase: phase });
    s.run({ ...input(2000), activeFlagPhase: undefined });
    expect(seen).toEqual([phase, undefined]);
  });
});
