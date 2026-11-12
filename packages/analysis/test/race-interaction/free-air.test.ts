// `race-interaction` judges free air by the shared rule (SP4.3a final review F2; C43): a car's pace in the following
// episodes is measured on its free-air laps, and which laps are free air is one judgement, `freeAirLaps` over the
// projection with `driver-noise`'s `freeAirGapMs` (as track-wetness and driver-noise judge it). race-interaction has no
// gap of its own.
//
// The scene: car 1 starts 0.4 s behind car 0 and gains 0.1 s a lap for four laps (held behind it, about a pass at lap
// 4), then pulls away at 1 s a lap for three laps. Its residuals against the field's median lap are −100 ms (laps 2–4)
// and −1,000 ms (laps 5–7): over every usable lap their median is −550 ms, over its free-air laps (after it pulled
// away) −1,000 ms. With driver-noise's gap 0 no lap is held, so every lap is free air and the pace is the median of all;
// with the default 1,500 ms only the laps clear of car 0 count. The pace advantage, and so the fitted curve, differ.
import { describe, expect, it } from 'vitest';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import { RACE_INTERACTION_CONFIG } from '../../src/race-interaction/index.ts';
import { DRIVER_NOISE_CONFIG } from '../../src/driver-noise/index.ts';
import { guardedQuick } from '../situated.ts';
import { laps, raceView, scene, type Scene } from './scene.ts';

const calc = guardedQuick(raceInteractionCalculator);

const PULL_AWAY: Scene = scene([
  { car: 0, startAt: 0, lapTimes: laps(7, 90_000) },
  { car: 1, startAt: 400, lapTimes: [...laps(4, 89_900), ...laps(3, 89_000)] },
  { car: 2, startAt: 10_000, lapTimes: laps(7, 90_000) },
]);

/** The calculator's output on the scene with driver-noise's `freeAirGapMs` set to `gapMs`. */
const withGap = (gapMs: number) => {
  const view = raceView(PULL_AWAY);
  return calc.compute({ ...view, config: { ...view.config, [DRIVER_NOISE_CONFIG.key]: { freeAirGapMs: gapMs } } });
};

describe('race-interaction free air (F2, C43)', () => {
  it('has no freeAirGapMs of its own', () => {
    expect(Object.keys(RACE_INTERACTION_CONFIG.defaults)).not.toContain('freeAirGapMs');
  });

  it("measures pace on the shared free-air laps with driver-noise's gap: another gap gives another pace advantage", () => {
    const shared = withGap(DRIVER_NOISE_CONFIG.defaults.freeAirGapMs);
    const everyLapFree = withGap(0);
    // the session's band (b0) was refined by the scene's episodes in both
    expect(shared.bands[0]!.episodes).toBeGreaterThan(0);
    expect(everyLapFree.bands[0]!.episodes).toBe(shared.bands[0]!.episodes);
    expect(everyLapFree.bands[0]!.curve).not.toEqual(shared.bands[0]!.curve);
  });

  it("the default view (no override) is the run with driver-noise's default gap", () => {
    expect(calc.compute(raceView(PULL_AWAY))).toEqual(withGap(DRIVER_NOISE_CONFIG.defaults.freeAirGapMs));
  });
});
