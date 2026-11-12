// SP4.3b Task 10b (ruling R19; C43, C50): `race-forecast` applies the pass curve's fitted `drsFactor` as
// `race-interaction` fits it (`src/race-interaction/fit.ts`): a log-odds shift inside the logistic,
//   p = cap · σ(level + slopePerMs · advantageMs + drsFactor · [DRS]), × wetFactor when wet,
// at the braking zone after a DRS zone; it no longer reads `RaceInteraction.drsPassFactor`.
//
// The seam of row 1 (the test agent's choice): `race-forecast/index.ts` exports its pass chance as
// `passChance(curve: PassCurve, wet: boolean, drs: boolean, advantageMs: number): number`, compared with the formula
// within 1e-9; the simulator is pinned to it on a two-car start in plain mode, where a held car passes once its summed
// hazard −ln(1 − p) reaches ln 2, i.e. at a lone zone with p ≥ 0.5: a DRS chance just above 0.5 passes on the first DRS
// lap, just below it waits for the next.
import type { PassCurve, Policy, StartingPoint } from '@pitwall/domain';
import { asOfNow, createRng, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import * as forecast from '../../src/race-forecast/index.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { buildStartingPoint } from '../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, TRACK, upstreamOf, type Generated } from '../shared/forecast-field/support.ts';
import { CURVE, drawn, interaction, noStops, NOISY, PACE_MS, PLAIN, startingPoint, traceAt, type CarSpec } from './start.ts';

type PassChance = (curve: PassCurve, wet: boolean, drs: boolean, advantageMs: number) => number;

/** The exported pass chance (row 1's seam); throws while the module has none. */
function passChanceOf(): PassChance {
  const f = (forecast as Record<string, unknown>)['passChance'];
  if (typeof f !== 'function') throw new Error('race-forecast exports no passChance(curve, wet, drs, advantageMs)');
  return f as PassChance;
}

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
/** fit.ts's model. */
const fitted = (c: PassCurve, wet: boolean, drs: boolean, u: number): number => (wet ? c.wetFactor : 1) * c.cap * sigmoid(c.level + c.slopePerMs * u + (drs ? c.drsFactor : 0));

const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A field of six cars 600 ms apart, each 300 ms a lap faster than the one ahead, with the AI field's noise. */
const TRAIN: CarSpec[] = range(0, 5).map((i) => ({ ...NOISY, retireRate: 0, gapMs: 600 * i, paceMs: PACE_MS - 300 * i }));
const SCENARIOS = range(1, 40).map((id) => drawn(id));

const forecastAll = (start: StartingPoint) => [PLAIN, ...SCENARIOS].map((s) => raceForecast(start, noStops(start.cars), s, createRng(s.id), { trace: true }));

describe('race-forecast: the fitted DRS factor (SP4.3b Task 10b)', () => {
  // row 1
  it('a follower in DRS gets the pass chance cap·σ(level + slope·u + drsFactor) at the braking zone after the DRS zone', () => {
    // the simulator: B, 1 s a lap faster, held behind A from lap 1; DRS from lap 3; outside DRS a pass is hopeless
    // (σ(−26)), so the first DRS braking zone (0.6, after the zone 0.45–0.55) decides lap 3 alone: p = 0.5 + δ passes there
    const u = 1_000;
    const level = -30;
    const slopePerMs = 0.004;
    const cap = 0.8;
    const drsFactorFor = (p: number): number => Math.log(p / cap / (1 - p / cap)) - level - slopePerMs * u;
    const passLap = (p: number): number => {
      const curve: PassCurve = { level, slopePerMs, cap, wetFactor: 1, drsFactor: drsFactorFor(p) };
      expect(Math.abs(fitted(curve, false, true, u) - p)).toBeLessThanOrEqual(1e-9);
      const start = startingPoint({
        lap: 1,
        lapsTotal: 8,
        cars: [{ gapMs: 0, paceMs: PACE_MS }, { gapMs: 600, paceMs: PACE_MS - u }],
        // drsPassFactor 1: the old ×factor model would never pass here
        interaction: interaction({ curve, drsPassFactor: 1 }),
      });
      const r = raceForecast(start, noStops(2), PLAIN, createRng(1), { trace: true });
      for (const lap of [1, 2]) expect(traceAt(r, lap).position[1]).toBe(2);
      return r.trace!.find((t) => t.position[1] === 1)?.lap ?? Infinity;
    };
    expect(passLap(0.5 + 1e-6)).toBe(3);
    expect(passLap(0.5 - 1e-6)).toBe(4);

    // the exported chance is the fitted model, within 1e-9
    const passChance = passChanceOf();
    const curves: PassCurve[] = [CURVE, { ...CURVE, drsFactor: 0 }, { ...CURVE, drsFactor: -0.7, wetFactor: 0.6 }, { level: -1.4, slopePerMs: 0.0025, cap: 0.55, wetFactor: 0.8, drsFactor: 2.3 }];
    for (const c of curves) {
      for (const u of [1, 120, 450, 1_000, 3_000]) {
        for (const wet of [false, true]) {
          for (const drs of [false, true]) expect(Math.abs(passChance(c, wet, drs, u) - fitted(c, wet, drs, u))).toBeLessThanOrEqual(1e-9);
        }
      }
    }
  });

  // row 2
  it('drsFactor 0 gives the same forecast as no DRS', () => {
    // no straight gain, so DRS can only act through the pass chance; "no DRS": DRS enabled only after the flag (the
    // lap's points, and so every draw's key, stay the same)
    const at = (drsFactor: number, fromLap: number): StartingPoint => {
      const start = startingPoint({ lap: 1, lapsTotal: 20, cars: TRAIN, interaction: interaction({ curve: { drsFactor }, drsStraightGainMs: 0 }) });
      return { ...start, drs: { ...start.drs, fromLap } };
    };
    expect(forecastAll(at(0, 3))).toEqual(forecastAll(at(0, 99)));
    // the DRS zones are live: a drsFactor of 2 changes the forecast
    expect(forecastAll(at(2, 3))).not.toEqual(forecastAll(at(2, 99)));
  });

  // row 3
  it('race-forecast no longer reads RaceInteraction.drsPassFactor: changing it alone changes nothing', () => {
    const at = (drsPassFactor: number, drsFactor = CURVE.drsFactor): StartingPoint =>
      startingPoint({ lap: 1, lapsTotal: 20, cars: TRAIN, interaction: interaction({ curve: { drsFactor }, drsPassFactor }) });
    const base = forecastAll(at(1.2));
    for (const drsPassFactor of [0, 1, 3, 1e6]) expect(forecastAll(at(drsPassFactor))).toEqual(base);
    // the curve's drsFactor is what moves it
    expect(forecastAll(at(1.2, 3))).not.toEqual(base);
  });
});

describe('race-forecast: the fitted DRS factor, rewind (SP4.3b Task 10b R1)', () => {
  let race: Generated | undefined;
  const gen = (): Generated => (race ??= generated());
  const HUMANS = [6, 7];

  /** forecast-field's live build at `now` (its pass curve, `drsFactor` included, is race-interaction's fit). */
  function buildAt(now: EngineView): StartingPoint {
    const view = materialised(asOfNow(now));
    const sp = buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at)));
    if (!sp.known) throw new Error(`the starting point is unknown (${sp.reason})`);
    return sp.value;
  }

  it('rewind: output equals a run without the undone frames (C33)', () => {
    const g = gen();
    const target = g.race.framesOfLap(8)[0]!;
    const undone = g.race.framesOfLap(11)[0]!;
    const rewoundView: EngineView = { ...g.race.viewAt(target, { from: undone }), track: TRACK };
    expect(rewoundView.delta.rewound).toBeDefined();
    const rewound = buildAt(rewoundView);
    const fresh = buildAt(g.viewAt(target));
    expect(rewound).toEqual(fresh);
    const policies: Policy[] = Array.from({ length: rewound.cars }, (_, k) => ({ stops: [{ lap: 12 + (k % 3), compound: 'hard' as const }], triggers: [] }));
    for (const s of [PLAIN, ...range(1, 10).map((id) => drawn(id))]) {
      expect(raceForecast(rewound, policies, s, createRng(s.id))).toEqual(raceForecast(fresh, policies, s, createRng(s.id)));
    }
  });
});
