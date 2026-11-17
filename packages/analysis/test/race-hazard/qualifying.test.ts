// `race-hazard`'s qualifying row (SP4.3d2 Task 6, SP4.3d spec §7.2; contract C3, C14, C44, C62d): the planning job runs
// the race's starting point on the ended qualifying session's as-of view, whose `fixed.totalLaps` is the race's laps as
// the user entered them (C62d). On it the qualifying row is `fromLapOne`: the track file's chances from lap 1 to
// `fixed.totalLaps`, whatever laps the qualifying session ran. Practice and `none` stay `notApplicable`.
import { carId, known, unknown, type LapRecord, type OpenSpan, type WeekendPhase } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { engineView, lap, neutralisation } from '../../../../test-support/builders/index.ts';
import { guardedView } from '../../../engine/test/support/scheduler.ts';
import { RACE_HAZARD, raceHazardAsOf, type RaceHazardOutput } from '../../src/race-hazard/index.ts';
import { RACE_HAZARD_BEHAVIOUR } from '../../src/race-hazard/behaviour.ts';
import { NONE, openSpan, PRACTICE, QUALIFYING } from '../situated.ts';
import { chanceOn, HAZARD, READS, TRACK } from './support.ts';

/** The race's laps as the user entered them in the planning round. */
const RACE_LAPS = 44;

/** A qualifying session's laps: cars 0 and 1 ran `n` laps each (out laps, push laps, in laps alike). */
const qualifyingLaps = (n: number): LapRecord[] =>
  Array.from({ length: n }, (_, k) => k + 1).flatMap((i) => [
    lap({ carId: carId(0), lapNumber: i, positionAtEnd: 1, frame: 100 * i, completedAt: 95_000 * i }),
    lap({ carId: carId(1), lapNumber: i, positionAtEnd: 2, frame: 100 * i + 10, completedAt: 95_000 * i + 900 }),
  ]);

/** The weekend-phase span that stands for `phase`. */
const phaseSpan = (phase: WeekendPhase): OpenSpan[] => {
  if (phase.kind === 'pending') return [];
  const { kind, ...detail } = phase;
  return [openSpan('weekend-phase', kind, { detail })];
};

/**
 * The ended session of weekend phase `phase` (default qualifying) as of its end: `done` laps per car, its own session
 * phase `finished` (no race session-phase span: a qualifying session has none), the lobby's SC setting `standard`, the
 * session's own totalLaps 0 in the live state.
 */
function endedSession(o: { phase?: WeekendPhase; done?: number; track?: EngineView['track'] } = {}): EngineView {
  const phase = o.phase ?? QUALIFYING;
  const byMachine: Record<string, OpenSpan[]> = { 'weekend-phase': phaseSpan(phase), 'session-phase-qualifying': [openSpan('session-phase-qualifying', 'finished')] };
  const done = o.done ?? 12;
  return engineView({
    history: { laps: qualifyingLaps(done) },
    situation: { weekendPhase: phase, byMachine },
    session: { totalLaps: 0, settings: { safetyCar: 'standard' } },
    track: o.track ?? TRACK,
    sessionTime: 95_000 * done + 5_000,
  });
}

/** The planning view (C62d): the session's as-of view with `fixed.totalLaps` the race's entered laps. */
function planningView(view: EngineView, totalLaps: number = RACE_LAPS): AsOfView {
  const now = asOfNow(view);
  return { ...now, fixed: { ...now.fixed, totalLaps: known(totalLaps, 0) } };
}

const valueOf = (out: RaceHazardOutput) => {
  if (!out.known) throw new Error(`race-hazard: unknown (${out.reason})`);
  return out.value;
};

describe("race-hazard's qualifying row (SP4.3d2 Task 6)", () => {
  it('the behaviour table gives qualifying fromLapOne; practice and none stay notApplicable', () => {
    expect(RACE_HAZARD_BEHAVIOUR['weekend-phase']).toEqual({ practice: 'notApplicable', qualifying: 'fromLapOne', race: 'table', none: 'notApplicable' });
  });

  it("a qualifying session's as-of view with the race's laps gives known values (not notApplicable)", () => {
    const out = raceHazardAsOf(planningView(endedSession()));
    expect(out.known).toBe(true);
    const value = valueOf(out);
    expect(value.active).toBeNull();
    expect(value.lobbyFactor).toBe(1);
    expect(value.durationLaps).toEqual(HAZARD.durationLaps);
  });

  it("its table covers laps 1 … fixed.totalLaps, each the track file's chance from lap 1, whatever laps qualifying ran", () => {
    for (const [done, total] of [
      [12, RACE_LAPS],
      [30, RACE_LAPS],
      [12, 30],
    ] as const) {
      const byLap = valueOf(raceHazardAsOf(planningView(endedSession({ done }), total))).byLap;
      expect(byLap.map((e) => e.lap), `${done} qualifying laps, ${total}-lap race`).toEqual(Array.from({ length: total }, (_, i) => i + 1));
      for (const e of byLap) {
        expect(e.sc, `sc on lap ${e.lap}`).toBeCloseTo(chanceOn(HAZARD, e.lap, total, 'sc'), 12);
        expect(e.vsc, `vsc on lap ${e.lap}`).toBeCloseTo(chanceOn(HAZARD, e.lap, total, 'vsc'), 12);
      }
    }
  });

  it('without a track file it stays notApplicable; without the race laps insufficientData (C3)', () => {
    expect(raceHazardAsOf(planningView(endedSession({ track: unknown('notApplicable') })))).toEqual(unknown('notApplicable'));
    const now = asOfNow(endedSession());
    expect(raceHazardAsOf({ ...now, fixed: { ...now.fixed, totalLaps: unknown('notReceived') } })).toEqual(unknown('insufficientData'));
  });

  it("the qualifying row reads no session phase: a guarded view (C41) with a qualifying red flag gives lastNeutralised null (F1)", () => {
    const base = endedSession();
    // a confirmed red flag of qualifying's own session phase, closed before the end (C20: in the projection's spans)
    const red = neutralisation({ kind: 'red', machine: 'session-phase-qualifying', start: 200_000, end: 400_000, startFrame: 200, endFrame: 400 });
    // the race's laps in the live session, so the as-of view's getters stay lazy under the guard (C41)
    const view: EngineView = {
      ...base,
      live: { ...base.live, session: { ...base.live.session, totalLaps: RACE_LAPS } },
      history: { ...base.history, spans: { ...base.history.spans, 'session-phase-qualifying': [red] } },
    };
    const value = valueOf(raceHazardAsOf(asOfNow(guardedView(view, READS, { unit: RACE_HAZARD }))));
    // lastNeutralised null: no lap blocked, every lap the track file's chance from lap 1
    expect(value.active).toBeNull();
    expect(value.byLap.map((e) => e.lap)).toEqual(Array.from({ length: RACE_LAPS }, (_, i) => i + 1));
    for (const e of value.byLap) {
      expect(e.sc, `sc on lap ${e.lap}`).toBeCloseTo(chanceOn(HAZARD, e.lap, RACE_LAPS, 'sc'), 12);
      expect(e.vsc, `vsc on lap ${e.lap}`).toBeCloseTo(chanceOn(HAZARD, e.lap, RACE_LAPS, 'vsc'), 12);
    }
  });

  it('practice rows unchanged: a practice or none session stays notApplicable, also with the race laps set', () => {
    for (const phase of [PRACTICE, NONE]) expect(raceHazardAsOf(planningView(endedSession({ phase }))), phase.kind).toEqual(unknown('notApplicable'));
  });
});
