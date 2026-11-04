// The race's neutralisations and suspensions (the `neutralised` and `suspended` spans of `session-phase-race`, which
// replaced the flag phases in Task 19) and mini-sector crossings beyond the main cases: guards and defaults (the pit
// stops moved to test/recorders/pit-stops.test.ts, migration Task 17; the leader's lap of a neutralisation is the
// readers' `leaderLapAt`, packages/analysis/test/shared/neutralised.test.ts).
import { describe, expect, it } from 'vitest';
import type { EventDetails } from '@pitwall/protocol';
import { ScenarioBuilder } from '../builders/index.ts';
import { runScenario } from '../support/run.ts';
import type { EngineState } from '../../src/index.ts';

const noop = () => {};

describe('neutralisations and suspensions (session-phase-race spans)', () => {
  /**
   * A race under way (every lap timer 30 s in, so `session-phase-race` joins it racing): its neutralised and suspended
   * spans are the neutralisations readers see (C20).
   */
  const rows = (cars: ReadonlyArray<{ position: number; lap: number; resultStatus?: number }>) =>
    new ScenarioBuilder({ cars: cars.length, stepMs: 1000 }).frames(1, (d) => {
      cars.forEach((c, i) => Object.assign(d.lapData.lapData[i]!, { carPosition: c.position, currentLapNum: c.lap, currentLapTimeInMs: 30_000, resultStatus: c.resultStatus ?? 2 }));
    });
  const scar = (safetyCarType: number, eventType: number): EventDetails => ({ code: 'SCAR', safetyCarType, eventType });
  /** The closed `neutralised` and `suspended` spans of the race. */
  const neutralisations = (st: EngineState) => (st.history.spans['session-phase-race'] ?? []).filter((s) => s.kind === 'neutralised' || s.kind === 'suspended');

  describe('safety car events', () => {
    const phases = (...events: EventDetails[]) => {
      const b = rows([{ position: 1, lap: 1 }]);
      for (const e of events) b.event(e).frames(1, noop);
      return neutralisations(runScenario(b.event({ code: 'SEND' }).frames(1, noop)).st);
    };
    it.each([
      ['no safety car', scar(0, 0)],
      ['the formation lap safety car', scar(3, 0)],
      ['a safety car type the game does not have', scar(7, 0)],
    ])('%s: a deployment opens no neutralisation', (_, event) => {
      expect(phases(event)).toEqual([]);
    });
    it('a return or a resume without a deployment opens no neutralisation', () => {
      expect(phases(scar(1, 1), scar(1, 2), scar(1, 3))).toEqual([]);
    });
    /** An SC deployed and confirmed by the status a frame later, then `events`. */
    const confirmedPhases = (...events: EventDetails[]) => {
      const b = rows([{ position: 1, lap: 1 }]).event(scar(1, 0)).frames(1, noop).session({ safetyCarStatus: 1 }).frames(1, noop);
      for (const e of events) b.event(e).frames(1, noop);
      return neutralisations(runScenario(b.event({ code: 'SEND' }).frames(1, noop)).st);
    };
    it('an event phase the game does not have is not recorded', () => {
      expect(confirmedPhases(scar(1, 9))).toMatchObject([{ kind: 'neutralised', confirmed: true, detail: { car: 'SC', stages: [{ stage: 'deployed', at: 1000 }] } }]);
    });
    it('an event of the other kind is not recorded in the open neutralisation', () => {
      expect(confirmedPhases(scar(2, 1))).toMatchObject([{ kind: 'neutralised', confirmed: true, detail: { car: 'SC', stages: [{ stage: 'deployed', at: 1000 }] } }]);
    });
    it('a deployment still unconfirmed at SEND closes as a neutralisation with `confirmed: false` (C18)', () => {
      expect(phases(scar(1, 0))).toMatchObject([{ kind: 'neutralised', confirmed: false, detail: { car: 'SC' } }]);
    });
  });

  it('lights out does not end a safety car neutralisation', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).session({ safetyCarStatus: 1 }).frames(1, noop).event({ code: 'LGOT' }).frames(1, noop)
      .session({ safetyCarStatus: 0 }).frames(1, noop));
    expect(neutralisations(st)).toMatchObject([{ kind: 'neutralised', start: 1000, end: 3000, detail: { car: 'SC' } }]);
  });
  it('the safety car going away does not end a suspension', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).session({ safetyCarStatus: 1 }).frames(1, noop).event({ code: 'RDFL' }).frames(1, noop)
      .session({ safetyCarStatus: 0 }).frames(1, noop).event({ code: 'STLG', numLights: 1 }).frames(1, noop));
    expect(neutralisations(st)).toMatchObject([{ kind: 'neutralised', start: 1000, end: 2000, detail: { car: 'SC' } }, { kind: 'suspended', start: 2000, end: 4000 }]);
  });
  it('the formation lap status does not end a suspension', () => {
    const { st } = runScenario(rows([{ position: 1, lap: 1 }]).event({ code: 'RDFL' }).frames(1, noop).session({ safetyCarStatus: 3 }).frames(1, noop)
      .event({ code: 'STLG', numLights: 1 }).frames(1, noop));
    expect(neutralisations(st)).toMatchObject([{ kind: 'suspended', start: 1000, end: 3000 }]);
  });
});

describe('mini-sector crossings', () => {
  // trackLength 5000 m → 50 segments of 100 m; frames every 100 ms
  const crossings = (samples: ReadonlyArray<readonly [lap: number, distance: number]>, session: { trackLength?: number } = {}) => {
    const { st, results } = runScenario(new ScenarioBuilder({ cars: 1, stepMs: 100 }).session(session).frames(samples.length, (d) => {
      Object.assign(d.lapData.lapData[0]!, { currentLapNum: samples[d.index]![0], lapDistance: samples[d.index]![1] });
    }));
    return { found: st.history.crossings.map(({ lap, segment, at }) => [lap, segment, at]), results };
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
