// SP4.3b Task 10 (spec §4, F5; R31 reversed): `race-interaction`'s pass curve gains a fitted DRS factor. `PassCurve`
// gains `drsFactor`, a log-odds shift for a zone with DRS: p = cap · σ(level + slopePerMs · advantageMs + drsFactor),
// × wetFactor when wet; `fitPassCurve` fits it with the level and the slope, shrunk to the prior's `drsFactor` (the
// config's `drsPassFactor`) with `shrinkEpisodes`.
//  - Generator races (rows 1, 3): 20 AI cars, 30 laps, five evenly spaced braking zones, the generator's pass hazard
//    ×3 in its two DRS zones (from lap 3). The generator passes on the DRS straight itself, so a pass in its DRS zone
//    between braking zones z and z + 1 is seen by the episodes at zone z (the follower is behind at z, ahead at z + 1):
//    the track file the episodes read carries each generator DRS zone as the one leading into zone z (same detection
//    timing, before z). The hazard is lower than the generator's default so the DRS zones' per-zone chance stays
//    under the cap.
//  - The truth as a log-odds shift: per zone the "per-zone equivalent" of the hazard (as 4.3a R1), `1 - exp(-hazard ×
//    interval)`, without DRS and with ×3 over the DRS zone's share of the interval (0.8), at 300 ms of advantage;
//    the factor is logit(pDrs / cap) − logit(pPlain / cap). Its standard error is the fitted curve's Fisher error.
import { carId, known, type PassCurve, type TrackData } from '@pitwall/domain';
import { projectionLengths } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import { fitPassCurve, followingEpisodes, RACE_INTERACTION_CONFIG, type FollowingEpisode } from '../../src/race-interaction/index.ts';
import { guardedQuick } from '../situated.ts';
import { trackOf, withTrack } from './generated.ts';
import { cutAt, laps, projectionOf, raceView, scene, TRACK } from './scene.ts';

const calc = guardedQuick(raceInteractionCalculator);
const CONFIG = RACE_INTERACTION_CONFIG.defaults;
const PRIOR: PassCurve = {
  level: CONFIG.passLevel,
  slopePerMs: CONFIG.passSlopePerMs,
  cap: CONFIG.passCap,
  wetFactor: CONFIG.wetFactor,
  drsFactor: CONFIG.drsPassFactor,
};

const RACES = 10;
const ZONES = [0.1, 0.3, 0.5, 0.7, 0.9];
const ADVANTAGE_MS = 300;
const DRS_FACTOR = 3;
/** The generator's DRS zones: 0.8 of the interval after braking zones 0 (0.1) and 2 (0.5). */
const GENERATOR_DRS = [
  { detection: 0.11, start: 0.12, end: 0.28 },
  { detection: 0.51, start: 0.52, end: 0.68 },
];
const DRS_SHARE = 0.8;
/** The same zones as the episodes see their passes: leading into braking zones 0 and 2. */
const EPISODE_DRS = [
  { detection: 0.94, start: 0.95, end: 0.05 },
  { detection: 0.44, start: 0.45, end: 0.49 },
];
const hazardPerS = (advantageMs: number): number => (advantageMs <= 0 ? 0 : 0.015 * (1 - Math.exp(-advantageMs / 300)));

/** Race `r`'s truth: 20 AI cars 120 ms apart a lap in a grid order that differs per race, DRS ×3, dry, no stops, no SC. */
const truthOf = (r: number): GeneratorParams => ({
  ...GENERATOR_DEFAULTS,
  laps: 30,
  brakingZones: ZONES,
  drsZones: GENERATOR_DRS,
  pass: { hazardPerS, drsFactor: DRS_FACTOR, minGapMs: CONFIG.minGapMs },
  field: GENERATOR_DEFAULTS.field.map((car, i) => ({ ...car, human: false, sigmaMs: 200, paceMs: 90_000 + 120 * ((i * 7 + r * 3) % 20), stops: [] })),
});

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const logit = (p: number): number => Math.log(p / (1 - p));

/** The 3×3 inverse by cofactors. */
function invert3(m: readonly (readonly number[])[]): number[][] {
  const [a, b, c] = m[0]!;
  const [d, e, f] = m[1]!;
  const [g, h, i] = m[2]!;
  const A = e! * i! - f! * h!;
  const B = -(d! * i! - f! * g!);
  const C = d! * h! - e! * g!;
  const det = a! * A + b! * B + c! * C;
  return [
    [A / det, -(b! * i! - c! * h!) / det, (b! * f! - c! * e!) / det],
    [B / det, (a! * i! - c! * g!) / det, -(a! * f! - c! * d!) / det],
    [C / det, -(a! * h! - b! * g!) / det, (a! * e! - b! * d!) / det],
  ];
}

/** The Fisher standard error of `curve`'s DRS factor over `episodes`' zones (level, slope, DRS factor). */
function drsFactorSe(episodes: readonly FollowingEpisode[], curve: PassCurve): number {
  const info = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const zone of episodes.flatMap((e) => e.zones)) {
    const x = [1, zone.advantageMs, zone.drs ? 1 : 0];
    const k = zone.wet ? curve.wetFactor : 1;
    const s = sigmoid(curve.level + curve.slopePerMs * zone.advantageMs + (zone.drs ? curve.drsFactor : 0));
    const p = k * curve.cap * s;
    const dp = k * curve.cap * s * (1 - s);
    const w = (dp * dp) / (p * (1 - p));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) info[i]![j]! += w * x[i]! * x[j]!;
  }
  return Math.sqrt(invert3(info)[2]![2]!);
}

const episodes: FollowingEpisode[] = [];
let plainTruth = 0;
let drsTruth = 0;

beforeAll(() => {
  const lapsMs: number[] = [];
  for (let r = 0; r < RACES; r++) {
    const truth = truthOf(r);
    const { race } = generateRace(truth, 1_000 + r);
    const history = race.viewAt(race.lastFrame).history;
    const track: TrackData = { ...trackOf(truth), drsZones: known(EPISODE_DRS, 0) };
    episodes.push(...followingEpisodes(history, track, CONFIG));
    for (const l of history.laps) if (l.status === 'confirmed' && l.lapNumber > 1) lapsMs.push(l.lapTimeMs);
  }
  const intervalS = median(lapsMs) / 1_000 / ZONES.length;
  const hazard = hazardPerS(ADVANTAGE_MS);
  plainTruth = 1 - Math.exp(-hazard * intervalS);
  drsTruth = 1 - Math.exp(-hazard * intervalS * (1 + (DRS_FACTOR - 1) * DRS_SHARE));
}, 120_000);

describe('race-interaction DRS factor (SP4.3b Task 10)', () => {
  it('on generator episodes with a known DRS factor of ×3, the fit recovers it within its standard error over 10 races', () => {
    const zones = episodes.flatMap((e) => e.zones);
    expect(zones.some((z) => z.drs && z.passed)).toBe(true);
    expect(zones.some((z) => !z.drs && z.passed)).toBe(true);
    const cap = PRIOR.cap;
    const truthFactor = logit(drsTruth / cap) - logit(plainTruth / cap);
    const curve = fitPassCurve(episodes, PRIOR, 0);
    expect(Number.isFinite(curve.drsFactor)).toBe(true);
    const se = drsFactorSe(episodes, curve);
    expect(se).toBeGreaterThan(0);
    expect(Math.abs(curve.drsFactor - truthFactor)).toBeLessThan(se);
  });

  it('no DRS zones in the data: the factor is the prior', () => {
    // FOLLOW on a track without DRS zones: every zone is without DRS
    const follow = scene([
      { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
      { car: 1, startAt: 400, lapTimes: laps(8, 89_900) },
      { car: 2, startAt: 10_000, lapTimes: laps(8, 90_000) },
    ]);
    const noDrs: TrackData = { ...TRACK, drsZones: known([], 0) };
    const found = followingEpisodes(projectionOf(follow), noDrs, CONFIG);
    expect(found.length).toBeGreaterThan(0);
    expect(found.flatMap((e) => e.zones).every((z) => !z.drs)).toBe(true);

    const prior: PassCurve = { ...PRIOR, drsFactor: 0.9 };
    for (const shrink of [CONFIG.shrinkEpisodes, 0]) {
      const fitted = fitPassCurve(found, prior, shrink);
      expect(fitted.drsFactor).toBeCloseTo(prior.drsFactor, 9);
      // the level and the slope are still fitted
      expect([fitted.level, fitted.slopePerMs]).not.toEqual([prior.level, prior.slopePerMs]);
    }
    // the calculator's session band: its prior's factor, the config's drsPassFactor
    const out = calc.compute(withTrack(raceView(follow), noDrs));
    expect(out.bands[0]!.episodes).toBeGreaterThan(0);
    expect(out.bands[0]!.curve.drsFactor).toBeCloseTo(CONFIG.drsPassFactor, 9);
    expect(out.bands[1]!.curve.drsFactor).toBe(CONFIG.drsPassFactor);
  });

  it('the level and slope are recovered as before with DRS zones in the data', () => {
    // 4.3a R1 with DRS zones: the fitted chance without DRS at 300 ms within 0.05 of the per-zone equivalent
    const curve = fitPassCurve(episodes, PRIOR, 0);
    const fitted = curve.cap * sigmoid(curve.level + curve.slopePerMs * ADVANTAGE_MS);
    expect(Math.abs(fitted - plainTruth)).toBeLessThan(0.05);
  });

  it('rewind: output equals a run without the undone frames (C33)', () => {
    // FOLLOW on the scene's track: car 1 0.4 s behind car 0 has DRS into braking zone 0 from lap 3
    const follow = scene([
      { car: 0, startAt: 0, lapTimes: laps(8, 90_000) },
      { car: 1, startAt: 400, lapTimes: laps(8, 89_900) },
      { car: 2, startAt: 10_000, lapTimes: laps(8, 90_000) },
    ]);
    expect(
      followingEpisodes(projectionOf(follow), TRACK, CONFIG)
        .filter((e) => e.follower === carId(1))
        .flatMap((e) => e.zones)
        .some((z) => z.drs),
    ).toBe(true);
    const target = 300_000;
    const cut = cutAt(follow, target);
    const rewound = raceView(cut, {
      sessionTime: target,
      delta: { before: projectionLengths(projectionOf(follow)), after: projectionLengths(projectionOf(cut)), rewound: { frameId: target, at: target } },
    });
    const fresh = calc.compute(raceView(cut, { sessionTime: target }));
    expect(Number.isFinite(fresh.bands[0]!.curve.drsFactor)).toBe(true);
    expect(calc.compute(rewound)).toEqual(fresh);
    // the undone frames held DRS zones: the run that kept them fits another factor
    expect(calc.compute(raceView(follow)).bands[0]!.curve.drsFactor).not.toBe(fresh.bands[0]!.curve.drsFactor);
  });
});
