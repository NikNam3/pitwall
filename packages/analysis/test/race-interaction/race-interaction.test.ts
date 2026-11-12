// `race-interaction` (SP4.3a spec 5.4, 5.5; plan Task 12): the pass curve per AI-difficulty band (a logistic per braking
// zone in pace advantage with its cap and wet factor), the DRS pass factor and straight gain, the minimum following gap,
// the O14 values and dirty air. A quick calculator (C31) at cadence `lapCompleted`; its scheduled run is its "as of"
// form at the current frame (`raceInteractionAsOf(asOfNow(view))`, spec 6.1).
//  - `followingEpisodes(history, track, config)`: per follower and leader, the braking zones the follower passed while
//    held, each with its pace advantage, DRS (relative: only where the car ahead is not itself in DRS range of its car
//    ahead), wet and whether it passed there; laps `excludedLap` leaves out give no zone (C43: the fit and the
//    calculator share the filter).
//  - `excludedLap(lap, ctx)`: the spec 5.5 filter: lap 1, in- and out-laps, SC and VSC laps, laps in a formation span
//    (membership, C26), a car with aero damage (wings) of 10 % or more.
//  - `fitPassCurve(episodes, prior, shrinkEpisodes)`: the prior refined by the episodes, the prior weighing as
//    `shrinkEpisodes` episodes; without episodes it is the prior.
//  - Prior order per band: the calibration's entries (`view.priors`, `raceInteraction.passLevel.b<i>` and
//    `raceInteraction.passSlope.b<i>`), else the config's default; then the session's band only refined by this race's
//    episodes with shrinkage (`shrinkEpisodes`); the source's `sessionShare` is `n / (n + shrinkEpisodes)` for `n` of this
//    race's episodes, its kind by the half rule (spec 4.4).
//  - `RACE_INTERACTION_PRIORS`: a band's entries aggregate the episodes of every source in that band (the source's
//    `aiDifficulty`) whose follower is the source stint's car, pooled, fitted from the config's default with its
//    shrinkage.
//  - Outside the race phase (`weekend-phase` row): `band`, `heldLossMsPerLap` and `rejoinPushBackMs` are `notApplicable`.
import { carId, currentLaps, known, unknown, type LapRecord, type PassCurve, type PriorsSnapshot } from '@pitwall/domain';
import { projectionLengths, type StoredSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { lap } from '../../../../test-support/builders/index.ts';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import {
  excludedLap,
  fitPassCurve,
  followingEpisodes,
  passLevelKey,
  passSlopeKey,
  RACE_INTERACTION,
  RACE_INTERACTION_CONFIG,
  RACE_INTERACTION_PRIORS,
  type FollowingEpisode,
  type LapFilterCtx,
} from '../../src/race-interaction/index.ts';
import { guardedQuick, QUALIFYING } from '../situated.ts';
import { CALCULATORS, loadUnitFolders } from '../units.ts';
import { cutAt, laps, projectionOf, raceView, scene, TRACK, type Scene } from './scene.ts';

const calc = guardedQuick(raceInteractionCalculator);
const CONFIG = RACE_INTERACTION_CONFIG.defaults;
const DEFAULT_CURVE: PassCurve = { level: CONFIG.passLevel, slopePerMs: CONFIG.passSlopePerMs, cap: CONFIG.passCap, wetFactor: CONFIG.wetFactor };
const CALIBRATED_CURVE: PassCurve = { ...DEFAULT_CURVE, level: -1.5, slopePerMs: 0.006 };

/** A calibration set `league` of 3 sources holding band 0's pass curve only. */
const LEAGUE: PriorsSnapshot = {
  fingerprint: 'fp-league',
  setId: 'league',
  setName: 'league',
  sources: 3,
  entries: { [passLevelKey(0)]: known(CALIBRATED_CURVE.level, 0), [passSlopeKey(0)]: known(CALIBRATED_CURVE.slopePerMs, 0) },
};

/** Car 1 starts 0.4 s behind car 0 and gains 0.1 s a lap: it is held, then passes about lap 4; car 2 runs alone 10 s back. */
const FOLLOW: Scene = scene([
  { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
  { car: 1, startAt: 400, lapTimes: laps(8, 89_900) },
  { car: 2, startAt: 10_000, lapTimes: laps(8, 90_000) },
]);

const zonesOf = (episodes: readonly FollowingEpisode[], follower: number, leader: number) =>
  episodes.filter((e) => e.follower === carId(follower) && e.leader === carId(leader)).flatMap((e) => e.zones);
const passesOf = (episodes: readonly FollowingEpisode[]): number => episodes.flatMap((e) => e.zones).filter((z) => z.passed).length;

describe('race-interaction', () => {
  it('is the quick calculator race-interaction: its reads, cadence lapCompleted (C31, C41)', () => {
    expect(raceInteractionCalculator.id).toBe(RACE_INTERACTION);
    expect(RACE_INTERACTION).toBe('race-interaction');
    expect(raceInteractionCalculator.kind).toBe('quick');
    expect([...raceInteractionCalculator.reads].sort()).toEqual(
      ['decisions', 'laps', 'miniSectors', 'pitStops', 'session', 'spans:car-status', 'spans:session-phase-race', 'spans:weekend-phase'].sort(),
    );
    expect(raceInteractionCalculator.cadence).toBe('lapCompleted');
  });

  it('guarded view and behaviour-table completeness pick it up (C41, C44)', async () => {
    // the generic tests (guarded-view-completeness, behaviour-completeness) run over every registered unit
    expect(CALCULATORS.map((c) => c.id)).toContain(RACE_INTERACTION);
    const folder = (await loadUnitFolders()).find((f) => f.unit === RACE_INTERACTION);
    expect(Object.keys(folder?.table ?? {}).sort()).toEqual(['car-status', 'session-phase-race', 'weekend-phase']);
  });

  it('notApplicable outside the race phase (weekend-phase row)', () => {
    const out = calc.compute(raceView(scene([]), { phase: QUALIFYING }));
    expect(out.band).toEqual(unknown('notApplicable'));
    expect(out.heldLossMsPerLap).toEqual(unknown('notApplicable'));
    expect(out.rejoinPushBackMs).toEqual(unknown('notApplicable'));
  });

  it('the band follows aiDifficulty (62 → b0, 90 → b1)', () => {
    const at62 = calc.compute(raceView(FOLLOW, { aiDifficulty: 62 }));
    const at90 = calc.compute(raceView(FOLLOW, { aiDifficulty: 90 }));
    expect(at62.bands.map((b) => [b.fromDifficulty, b.toDifficulty])).toEqual([
      [0, 79],
      [80, 110],
    ]);
    expect(at62.band).toEqual(expect.objectContaining({ known: true, value: 0 }));
    expect(at90.band).toEqual(expect.objectContaining({ known: true, value: 1 }));
    // this race's episodes refine the session's band only
    expect(at62.bands[0]!.episodes).toBeGreaterThan(0);
    expect(at62.bands[1]!.episodes).toBe(0);
    expect(at90.bands[0]!.episodes).toBe(0);
    expect(at90.bands[1]!.episodes).toBe(at62.bands[0]!.episodes);
  });

  it('DRS straight gain is relative: two cars both in DRS range gain nothing on each other', () => {
    // a train: car 1 0.4 s behind car 0, car 2 0.4 s behind car 1, through the DRS zone before braking zone 0
    const train = scene([
      { car: 0, startAt: 0, lapTimes: laps(6, 90_000) },
      { car: 1, startAt: 400, lapTimes: laps(6, 90_000) },
      { car: 2, startAt: 800, lapTimes: laps(6, 90_000) },
    ]);
    const episodes = followingEpisodes(projectionOf(train), TRACK, CONFIG);
    const second = zonesOf(episodes, 1, 0).filter((z) => z.zone === 0);
    const third = zonesOf(episodes, 2, 1).filter((z) => z.zone === 0);
    expect(second.length).toBeGreaterThan(0);
    expect(third.length).toBeGreaterThan(0);
    // car 1 has DRS on car 0, which has no car within range ahead
    expect(second.some((z) => z.drs)).toBe(true);
    // car 1 is itself in DRS range of car 0: car 2's DRS gains nothing on it
    expect(third.every((z) => !z.drs)).toBe(true);
    // braking zone 1 has no DRS zone before it
    expect([...zonesOf(episodes, 1, 0), ...zonesOf(episodes, 2, 1)].filter((z) => z.zone === 1).every((z) => !z.drs)).toBe(true);
    // the config holds the one straight gain every car in range gets
    expect(calc.compute(raceView(train)).drsStraightGainMs).toBe(CONFIG.drsStraightGainMs);
  });

  describe('an episode across a stop, lap 1, SC/VSC or formation laps, or a car with ≥ 10 % aero damage is excluded', () => {
    const FORMATION = {
      machine: 'session-phase-race', id: 0, kind: 'formation', start: 0, end: 200_000, confirmed: true, detail: undefined, startFrame: 0, endFrame: 200_000,
    };
    const ctx: LapFilterCtx = { source: { history: { ...projectionOf(scene([])), spans: { 'session-phase-race': [FORMATION] } } }, config: CONFIG };
    const base = lap({ carId: carId(1), lapNumber: 5, completedAt: 450_000, frame: 450_000 });
    const damaged = (parts: Partial<Extract<LapRecord['damageAtEnd'], { known: true }>['value']>): LapRecord => ({
      ...base,
      damageAtEnd: known({ ...(base.damageAtEnd as Extract<LapRecord['damageAtEnd'], { known: true }>).value, ...parts }, 450_000),
    });

    it('excludedLap: lap 1, in- and out-laps, SC and VSC laps, formation laps, aero damage of 10 % or more', () => {
      expect(excludedLap(base, ctx)).toBe(false);
      expect(excludedLap({ ...base, lapNumber: 1 }, ctx)).toBe(true);
      expect(excludedLap({ ...base, inLap: true }, ctx)).toBe(true);
      expect(excludedLap({ ...base, outLap: true }, ctx)).toBe(true);
      expect(excludedLap({ ...base, scShare: 0.3 }, ctx)).toBe(true);
      expect(excludedLap({ ...base, vscShare: 0.5 }, ctx)).toBe(true);
      // the lap's frame lies in the formation span (membership, C26)
      expect(excludedLap({ ...base, lapNumber: 2, completedAt: 150_000, frame: 150_000 }, ctx)).toBe(true);
      expect(excludedLap(damaged({ frontLeftWingPct: 10 }), ctx)).toBe(true);
      expect(excludedLap(damaged({ rearWingPct: 25 }), ctx)).toBe(true);
      expect(excludedLap(damaged({ frontRightWingPct: 9 }), ctx)).toBe(false);
      // no aero damage: a gearbox or an engine does not change how a car follows
      expect(excludedLap(damaged({ gearboxPct: 50, enginePct: 40 }), ctx)).toBe(false);
    });

    it('a pass caused by a stop is no pass: the leader pits from 0.4 s ahead', () => {
      const stop = scene([
        { car: 0, startAt: 0, lapTimes: [...laps(4, 90_000), 98_000, 104_000, ...laps(2, 90_000)], inLaps: [5] },
        { car: 1, startAt: 400, lapTimes: laps(8, 90_000) },
      ]);
      const episodes = followingEpisodes(projectionOf(stop), TRACK, CONFIG);
      expect(zonesOf(episodes, 1, 0).length).toBeGreaterThan(0);
      expect(passesOf(episodes)).toBe(0);
    });

    it('a pass on lap 1 is no pass: car 1 passes car 0 early in lap 1, then car 0 closes in without passing', () => {
      const start = scene([
        { car: 0, startAt: 0, lapTimes: [90_000, ...laps(5, 89_700)] },
        { car: 1, startAt: 300, lapTimes: [88_000, ...laps(5, 90_000)] },
      ]);
      const episodes = followingEpisodes(projectionOf(start), TRACK, CONFIG);
      expect(zonesOf(episodes, 0, 1).length).toBeGreaterThan(0);
      expect(passesOf(episodes)).toBe(0);
    });
  });

  describe('prior order: calibration entry, else config default, then this race\'s episodes with shrinkage, each with its source', () => {
    it('without a calibration and without episodes: every band is the config default; the fixed values are the config\'s', () => {
      const out = calc.compute(raceView(scene([])));
      expect(out.bands).toHaveLength(2);
      for (const band of out.bands) {
        expect(band.curve).toEqual(DEFAULT_CURVE);
        expect([band.episodes, band.passes]).toEqual([0, 0]);
        expect(band.source).toEqual(expect.objectContaining({ kind: 'default', sessionShare: 0 }));
      }
      expect([out.drsPassFactor, out.drsStraightGainMs, out.minGapMs, out.dirtyAirMsPerLap]).toEqual([
        CONFIG.drsPassFactor, CONFIG.drsStraightGainMs, CONFIG.minGapMs, CONFIG.dirtyAirMsPerLap,
      ]);
      expect(out.heldLossMsPerLap).toEqual(expect.objectContaining({ known: true, value: CONFIG.heldLossMsPerLap }));
      expect(out.rejoinPushBackMs).toEqual(expect.objectContaining({ known: true, value: CONFIG.rejoinPushBackMs }));
    });

    it('a calibration entry replaces the default of its band; a band without one keeps the default', () => {
      const out = calc.compute(raceView(scene([]), { priors: LEAGUE }));
      expect(out.bands[0]!.curve).toEqual(CALIBRATED_CURVE);
      expect(out.bands[0]!.source).toEqual(expect.objectContaining({ kind: 'calibration', setName: 'league', sources: 3, sessionShare: 0 }));
      expect(out.bands[1]!.curve).toEqual(DEFAULT_CURVE);
      expect(out.bands[1]!.source.kind).toBe('default');
    });

    it("this race's episodes refine the session's band from its prior with shrinkage", () => {
      const episodes = followingEpisodes(projectionOf(FOLLOW), TRACK, CONFIG);
      const n = episodes.length;
      expect(n).toBeGreaterThan(0);
      const share = n / (n + CONFIG.shrinkEpisodes);
      expect(share).toBeLessThanOrEqual(0.5);

      const calibrated = calc.compute(raceView(FOLLOW, { priors: LEAGUE }));
      expect(calibrated.bands[0]!.curve).toEqual(fitPassCurve(episodes, CALIBRATED_CURVE, CONFIG.shrinkEpisodes));
      expect([calibrated.bands[0]!.episodes, calibrated.bands[0]!.passes]).toEqual([n, passesOf(episodes)]);
      expect(calibrated.bands[0]!.source).toEqual(expect.objectContaining({ kind: 'calibration', setName: 'league', sessionShare: share }));
      expect(calibrated.bands[1]!.curve).toEqual(DEFAULT_CURVE);

      const plain = calc.compute(raceView(FOLLOW));
      expect(plain.bands[0]!.curve).toEqual(fitPassCurve(episodes, DEFAULT_CURVE, CONFIG.shrinkEpisodes));
      expect(plain.bands[0]!.source).toEqual(expect.objectContaining({ kind: 'default', sessionShare: share }));
    });

    it('fitPassCurve: no episodes give the prior; the cap and the wet factor stay the prior\'s', () => {
      expect(fitPassCurve([], CALIBRATED_CURVE, CONFIG.shrinkEpisodes)).toEqual(CALIBRATED_CURVE);
      const fitted = fitPassCurve(followingEpisodes(projectionOf(FOLLOW), TRACK, CONFIG), CALIBRATED_CURVE, CONFIG.shrinkEpisodes);
      expect([fitted.cap, fitted.wetFactor]).toEqual([CALIBRATED_CURVE.cap, CALIBRATED_CURVE.wetFactor]);
      expect(Number.isFinite(fitted.level) && Number.isFinite(fitted.slopePerMs)).toBe(true);
    });
  });

  describe('a priors aggregate over two sources pools their episodes', () => {
    /** A stored source of session `session` (AI difficulty `difficulty`): car 1's stint over the whole scene. */
    const sourceOf = (s: Scene, session: string, difficulty: number): StoredSource => {
      const sessionLaps = currentLaps(s.laps);
      return {
        source: { sessionUid: session, weekendId: 'w1', feedCar: carId(0), car: carId(1), firstLap: 1, excludedLaps: [] },
        phase: { kind: 'race', format: 'grandPrix' },
        stint: { carId: carId(1), firstLap: 1, lastLap: 8, actualCompound: 'C3', visualCompound: 'soft', tyreAgeAtFitting: 0, frame: 0 },
        laps: sessionLaps.filter((l) => l.carId === carId(1)),
        pitStops: s.pitStops,
        sessionLaps,
        track: known(TRACK, 0),
        aiDifficulty: known(difficulty, 0),
        projection: projectionOf(s),
      };
    };
    /** Car 1 starts 0.4 s behind car 0 and gains `gainMs` a lap. */
    const chase = (gainMs: number): Scene =>
      scene([
        { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
        { car: 1, startAt: 400, lapTimes: laps(8, 90_000 - gainMs) },
      ]);
    const A = chase(100);
    const B = chase(40);
    const C = chase(150);
    const ctx = { config: {}, overrides: {} };
    const carOnes = (s: Scene) => followingEpisodes(projectionOf(s), TRACK, CONFIG).filter((e) => e.follower === carId(1));
    const valueOf = (key: string, sources: StoredSource[]): number => {
      const v = RACE_INTERACTION_PRIORS.entries[key]!.aggregate!(sources, ctx);
      if (!v.known) throw new Error(`${key}: ${v.reason}`);
      return v.value;
    };

    it('declares a level and a slope per configured band', () => {
      expect(Object.keys(RACE_INTERACTION_PRIORS.entries).sort()).toEqual([passLevelKey(0), passLevelKey(1), passSlopeKey(0), passSlopeKey(1)].sort());
      expect(RACE_INTERACTION_PRIORS.unit).toBe(RACE_INTERACTION);
    });

    it("pools the sources of a band (their aiDifficulty): b0 over 62 and 70, b1 over 90", () => {
      const sources = [sourceOf(A, '1', 62), sourceOf(B, '2', 70), sourceOf(C, '3', 90)];
      const b0 = fitPassCurve([...carOnes(A), ...carOnes(B)], DEFAULT_CURVE, CONFIG.shrinkEpisodes);
      const b1 = fitPassCurve(carOnes(C), DEFAULT_CURVE, CONFIG.shrinkEpisodes);
      expect(valueOf(passLevelKey(0), sources)).toBeCloseTo(b0.level, 9);
      expect(valueOf(passSlopeKey(0), sources)).toBeCloseTo(b0.slopePerMs, 9);
      expect(valueOf(passLevelKey(1), sources)).toBeCloseTo(b1.level, 9);
      expect(valueOf(passSlopeKey(1), sources)).toBeCloseTo(b1.slopePerMs, 9);
      // pooled, not one source's: two sources differ from either alone
      expect(valueOf(passLevelKey(0), sources)).not.toBeCloseTo(valueOf(passLevelKey(0), [sourceOf(A, '1', 62)]), 9);
    });
  });

  it('rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    const target = 300_000;
    const cut = cutAt(FOLLOW, target);
    const rewound = raceView(cut, {
      sessionTime: target,
      delta: { before: projectionLengths(projectionOf(FOLLOW)), after: projectionLengths(projectionOf(cut)), rewound: { frameId: target, at: target } },
    });
    const fresh = calc.compute(raceView(cut, { sessionTime: target }));
    expect(calc.compute(rewound)).toEqual(fresh);
    // the undone frames held episodes: the run that kept them differs
    expect(calc.compute(raceView(FOLLOW))).not.toEqual(fresh);
  });
});
