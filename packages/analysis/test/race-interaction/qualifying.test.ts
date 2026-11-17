// `race-interaction`'s qualifying row (SP4.3d2 Task 6, SP4.3d spec §7.2; contract C3, C14, C44, C62d): the planning job
// runs the race's starting point on the ended qualifying session's as-of view, its `fixed.totalLaps` the race's entered
// laps (C62d). On it the unit gives its priors and defaults: the session's band from its AI difficulty, each band's curve
// its prior (the calibration's entries, else the config's default), the O14 values the config's. No qualifying lap holds
// a following episode, so no band is refined by the session. Practice and `none` stay `notApplicable`.
import { known, unknown, type PassCurve, type PriorsSnapshot } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import { RACE_INTERACTION_BEHAVIOUR } from '../../src/race-interaction/behaviour.ts';
import { passLevelKey, passSlopeKey, RACE_INTERACTION_CONFIG, raceInteractionAsOf } from '../../src/race-interaction/index.ts';
import { guardedQuick, NONE, openSpan, PRACTICE, QUALIFYING } from '../situated.ts';
import { laps, raceView, scene, type Scene } from './scene.ts';

const calc = guardedQuick(raceInteractionCalculator);
const CONFIG = RACE_INTERACTION_CONFIG.defaults;
const DEFAULT_CURVE: PassCurve = { level: CONFIG.passLevel, slopePerMs: CONFIG.passSlopePerMs, cap: CONFIG.passCap, wetFactor: CONFIG.wetFactor, drsFactor: CONFIG.drsPassFactor };
const CALIBRATED_CURVE: PassCurve = { ...DEFAULT_CURVE, level: -1.5, slopePerMs: 0.006 };

/** A calibration set holding band 0's pass curve only. */
const LEAGUE: PriorsSnapshot = {
  fingerprint: 'fp-league',
  setId: 'league',
  setName: 'league',
  sources: 3,
  entries: { [passLevelKey(0)]: known(CALIBRATED_CURVE.level, 0), [passSlopeKey(0)]: known(CALIBRATED_CURVE.slopePerMs, 0) },
};

/** Car 1 starts 0.4 s behind car 0 and gains 0.1 s a lap: in a race it is held, then passes (episodes, `race-interaction.test.ts`). */
const FOLLOW: Scene = scene([
  { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
  { car: 1, startAt: 400, lapTimes: laps(8, 89_900) },
  { car: 2, startAt: 10_000, lapTimes: laps(8, 90_000) },
]);

/** The race's laps as the user entered them in the planning round. */
const RACE_LAPS = 44;

/** The ended qualifying session's view: `FOLLOW`'s laps run in qualifying, its session phase `finished`. */
const qualifyingView = (o: { priors?: PriorsSnapshot; aiDifficulty?: number } = {}): EngineView => {
  const view = raceView(FOLLOW, { phase: QUALIFYING, ...o });
  const byMachine = { ...view.situation.byMachine, 'session-phase-qualifying': [openSpan('session-phase-qualifying', 'finished')] };
  return { ...view, situation: { ...view.situation, byMachine } };
};

/** The planning view (C62d): the session's as-of view with `fixed.totalLaps` the race's entered laps. */
const planningView = (view: EngineView): AsOfView => {
  const now = asOfNow(view);
  return { ...now, fixed: { ...now.fixed, totalLaps: known(RACE_LAPS, 0) } };
};

describe("race-interaction's qualifying row (SP4.3d2 Task 6)", () => {
  it('the behaviour table gives qualifying values; practice and none stay notApplicable', () => {
    const rows = RACE_INTERACTION_BEHAVIOUR['weekend-phase']!;
    expect(rows['qualifying']?.notApplicable).not.toBe(true);
    for (const kind of ['practice', 'none']) expect(rows[kind]?.notApplicable, kind).toBe(true);
  });

  it("a qualifying session's as-of view gives known values: the band, the O14 values the config's", () => {
    for (const out of [raceInteractionAsOf(planningView(qualifyingView())), calc.compute(qualifyingView())]) {
      expect(out.band).toEqual(expect.objectContaining({ known: true, value: 0 }));
      expect(out.heldLossMsPerLap).toEqual(expect.objectContaining({ known: true, value: CONFIG.heldLossMsPerLap }));
      expect(out.rejoinPushBackMs).toEqual(expect.objectContaining({ known: true, value: CONFIG.rejoinPushBackMs }));
    }
    expect(raceInteractionAsOf(planningView(qualifyingView({ aiDifficulty: 90 }))).band).toEqual(expect.objectContaining({ known: true, value: 1 }));
  });

  it("each band's curve is its prior: the calibration's entries, else the config's default", () => {
    const out = raceInteractionAsOf(planningView(qualifyingView({ priors: LEAGUE })));
    expect(out.bands[0]!.curve).toEqual(CALIBRATED_CURVE);
    expect(out.bands[0]!.source.kind).toBe('calibration');
    expect(out.bands[1]!.curve).toEqual(DEFAULT_CURVE);
    expect(out.bands[1]!.source.kind).toBe('default');
    const plain = raceInteractionAsOf(planningView(qualifyingView()));
    expect(plain.bands.map((b) => b.curve)).toEqual([DEFAULT_CURVE, DEFAULT_CURVE]);
  });

  it('no qualifying lap holds a following episode: no band is refined by the session', () => {
    // the same laps in a race hold episodes in the session's band
    expect(calc.compute(raceView(FOLLOW)).bands[0]!.episodes).toBeGreaterThan(0);
    for (const out of [raceInteractionAsOf(planningView(qualifyingView({ priors: LEAGUE }))), calc.compute(qualifyingView({ priors: LEAGUE }))]) {
      expect(out.bands.map((b) => [b.episodes, b.passes])).toEqual([
        [0, 0],
        [0, 0],
      ]);
      expect(out.bands[0]!.source.sessionShare).toBe(0);
    }
  });

  it('practice rows unchanged: practice and none stay notApplicable', () => {
    for (const phase of [PRACTICE, NONE]) {
      const out = calc.compute(raceView(FOLLOW, { phase }));
      expect(out.band, phase.kind).toEqual(unknown('notApplicable'));
      expect(out.heldLossMsPerLap, phase.kind).toEqual(unknown('notApplicable'));
      expect(out.rejoinPushBackMs, phase.kind).toEqual(unknown('notApplicable'));
    }
  });
});
