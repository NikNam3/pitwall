// R1 of `race-interaction` (SP4.3a plan Task 12, spec 6.4, 9): the pass curve fitted on generated races recovers the
// generator's pass hazard. The generator passes by a hazard over time while a faster car is held within `minGapMs`;
// over the time between two of its five evenly spaced braking zones (a fifth of a lap) that hazard is a pass chance per
// zone, `1 - exp(-hazard × interval)`: the "per-zone equivalent" the fitted curve's pass probability at 300 ms of
// advantage must lie within 0.05 of, over 10 races. Dry, no DRS, no stops, no SC, so only the curve itself is fitted.
// The races are generated once (P8: 20 cars, 30 laps, the smallest field and length with enough held episodes).
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { fitPassCurve, followingEpisodes, RACE_INTERACTION_CONFIG, type FollowingEpisode } from '../../src/race-interaction/index.ts';
import { trackOf } from './generated.ts';

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 === 1 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const CONFIG = RACE_INTERACTION_CONFIG.defaults;
const RACES = 10;
const ZONES = [0.1, 0.3, 0.5, 0.7, 0.9];
const ADVANTAGE_MS = 300;

/** Race `r`'s truth: 20 AI cars 120 ms apart a lap in a grid order that differs per race, so faster cars start behind slower ones. */
const truthOf = (r: number): GeneratorParams => ({
  ...GENERATOR_DEFAULTS,
  laps: 30,
  brakingZones: ZONES,
  drsZones: [],
  pass: { ...GENERATOR_DEFAULTS.pass, drsFactor: 1, minGapMs: CONFIG.minGapMs },
  field: GENERATOR_DEFAULTS.field.map((car, i) => ({ ...car, human: false, sigmaMs: 200, paceMs: 90_000 + 120 * ((i * 7 + r * 3) % 20), stops: [] })),
});

const episodes: FollowingEpisode[] = [];
let perZoneTruth = 0;

beforeAll(() => {
  const lapsMs: number[] = [];
  for (let r = 0; r < RACES; r++) {
    const truth = truthOf(r);
    const { race } = generateRace(truth, 1_000 + r);
    const history = race.viewAt(race.lastFrame).history;
    episodes.push(...followingEpisodes(history, trackOf(truth), CONFIG));
    for (const l of history.laps) if (l.status === 'confirmed' && l.lapNumber > 1) lapsMs.push(l.lapTimeMs);
  }
  const intervalS = median(lapsMs) / 1_000 / ZONES.length;
  perZoneTruth = 1 - Math.exp(-GENERATOR_DEFAULTS.pass.hazardPerS(ADVANTAGE_MS) * intervalS);
});

describe('race-interaction recovery (R1)', () => {
  it("recovers the generator's parameters within its noise", () => {
    expect(episodes.length).toBeGreaterThan(0);
    // ported in SP4.3b Task 10 (the fitted DRS factor): the prior curve carries `drsFactor`; no DRS zones here, so it stays unread
    const prior = { level: CONFIG.passLevel, slopePerMs: CONFIG.passSlopePerMs, cap: CONFIG.passCap, wetFactor: CONFIG.wetFactor, drsFactor: CONFIG.drsPassFactor };
    const curve = fitPassCurve(episodes, prior, 0);
    const fitted = curve.cap / (1 + Math.exp(-(curve.level + curve.slopePerMs * ADVANTAGE_MS)));
    expect(Math.abs(fitted - perZoneTruth)).toBeLessThan(0.05);
  });
});
