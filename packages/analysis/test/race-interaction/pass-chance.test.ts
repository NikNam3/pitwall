// SP4.3c Task 15 (O13, C43, C50): "can a car pass" is `race-interaction`'s, one pass curve for every reader. It exports
// `passChance(deltaMs, gapMs, ctx)`, today's curve (the model `fit.ts` fits, formerly `race-forecast`'s own copy):
//   p = cap · σ(level + slopePerMs · deltaMs + drsFactor · [DRS]), × wetFactor when wet,
// the chance of a pass at one braking zone of a car `deltaMs` a lap faster than the car ahead, `gapMs` behind it.
//
// The seam (the test agent's decisions, Task 15 report):
// - `ctx` is `PassContext = { curve: PassCurve; wet: boolean; drs: boolean; drsRangeMs: number }`: the session's curve,
//   the one wet rule's verdict (`track-wetness`), whether DRS is open to the follower (race control has it on, or in the
//   simulator the zone follows a DRS zone the follower was in range at), and the one DRS range (`drsRangeMs`).
// - The DRS term counts when `ctx.drs` and the gap is within `ctx.drsRangeMs` (at most, inclusive).
// - A car no faster than the one ahead (`deltaMs <= 0`) never passes: 0 (the simulator passes only with an advantage).
// - `sessionCurve(interaction)` is the session's curve: its band's (`band`), else the first band's; `undefined` without a
//   band (none passes). `race-forecast` and `battle` both take the curve from it (its `curveOf` is deleted).
import { known, unknown, type PassCurve, type RaceInteraction } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import * as forecast from '../../src/race-forecast/index.ts';
import { passChance, sessionCurve, type PassContext } from '../../src/race-interaction/index.ts';

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
/** fit.ts's model. */
const fitted = (c: PassCurve, wet: boolean, drs: boolean, u: number): number => (wet ? c.wetFactor : 1) * c.cap * sigmoid(c.level + c.slopePerMs * u + (drs ? c.drsFactor : 0));

const CURVE: PassCurve = { level: -2.629, slopePerMs: 0.001044, cap: 0.6, wetFactor: 0.46, drsFactor: 1.917 };
const ctx = (over: Partial<PassContext> = {}): PassContext => ({ curve: CURVE, wet: false, drs: true, drsRangeMs: 1_000, ...over });

describe('race-interaction: the pass chance (SP4.3c Task 15, O13)', () => {
  it("is today's curve: cap · σ(level + slope · Δ + drsFactor · [DRS]), × wetFactor when wet", () => {
    const curves: PassCurve[] = [CURVE, { ...CURVE, drsFactor: 0 }, { ...CURVE, drsFactor: -0.7, wetFactor: 0.6 }, { level: -1.4, slopePerMs: 0.0025, cap: 0.55, wetFactor: 0.8, drsFactor: 2.3 }];
    for (const curve of curves) {
      for (const u of [1, 120, 450, 1_000, 3_000]) {
        for (const wet of [false, true]) {
          for (const drs of [false, true]) {
            // inside the DRS range: the DRS term counts as `drs` says
            expect(Math.abs(passChance(u, 400, ctx({ curve, wet, drs })) - fitted(curve, wet, drs, u))).toBeLessThanOrEqual(1e-9);
          }
        }
      }
    }
  });

  it('500 ms a lap faster, 0.8 s behind with DRS, dry: 0.6 · σ(−2.629 + 0.522 + 1.917)', () => {
    expect(passChance(500, 800, ctx())).toBeCloseTo(0.6 * sigmoid(-2.629 + 0.001044 * 500 + 1.917), 12);
  });

  it('the DRS term counts only within the DRS range: at the range yes, beyond it no; with DRS closed never', () => {
    expect(passChance(500, 1_000, ctx())).toBeCloseTo(fitted(CURVE, false, true, 500), 12);
    expect(passChance(500, 1_001, ctx())).toBeCloseTo(fitted(CURVE, false, false, 500), 12);
    expect(passChance(500, 1_600, ctx({ drsRangeMs: 2_000 }))).toBeCloseTo(fitted(CURVE, false, true, 500), 12);
    expect(passChance(500, 300, ctx({ drs: false }))).toBeCloseTo(fitted(CURVE, false, false, 500), 12);
  });

  it('a car no faster than the one ahead never passes: 0', () => {
    expect(passChance(0, 300, ctx())).toBe(0);
    expect(passChance(-250, 300, ctx())).toBe(0);
  });

  it('wet: the dry chance × wetFactor', () => {
    expect(passChance(800, 300, ctx({ wet: true }))).toBeCloseTo(CURVE.wetFactor * passChance(800, 300, ctx()), 12);
  });

  it("sessionCurve: the session's band's curve, else the first band's; none without a band", () => {
    const band = (curve: PassCurve): RaceInteraction['bands'][number] => ({ fromDifficulty: 0, toDifficulty: 110, curve, source: { kind: 'default', note: 'test', sessionShare: 0, parts: '' }, episodes: 0, passes: 0 });
    const other: PassCurve = { ...CURVE, level: -1 };
    const of = (bands: RaceInteraction['bands'], b: RaceInteraction['band']): RaceInteraction => ({
      bands,
      band: b,
      drsPassFactor: 1,
      drsStraightGainMs: 250,
      minGapMs: 500,
      heldLossMsPerLap: known(0, 0),
      rejoinPushBackMs: known(0, 0),
      dirtyAirMsPerLap: 0,
    });
    expect(sessionCurve(of([band(CURVE), band(other)], known(1, 0)))).toEqual(other);
    expect(sessionCurve(of([band(CURVE), band(other)], unknown('notReceived')))).toEqual(CURVE);
    expect(sessionCurve(of([band(CURVE)], known(4, 0)))).toEqual(CURVE);
    expect(sessionCurve(of([], known(0, 0)))).toBeUndefined();
  });

  it("is the one pass curve: race-forecast no longer exports a pass chance of its own", () => {
    expect((forecast as Record<string, unknown>)['passChance']).toBeUndefined();
  });
});
