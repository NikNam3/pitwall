// SP4.3b Task 11h (the pit-exit yield; C2, C33, C50): a stopper whose rejoin lands just ahead of a car that stayed out
// yields to it, as in F1 25.
//
// The rule (`crossLine`): after the stoppers' rejoin times are set, a stopper whose rejoin time T at the pit-exit line
// has a non-stopping car crossing that line at t_o in [T, T + minGapMs) rejoins at t_o + minGapMs, behind it. It yields
// once, to the first such car (no cascade). The window is `start.interaction.minGapMs`; plain and drawn modes alike.
//
// The fields (`start.ts`, C84): equal pace, no passes (cap 0), no DRS, the green loss 22 s with no in-lap share. The stopper
// leads, at its line starting lap 10, and stops at the end of lap 12; it rejoins 22 s after it crossed that line. A car
// `22 s + d` behind it crosses that line `d` after the stopper's rejoin time.
import type { Policy, StartingPoint } from '@pitwall/domain';
import { asOfNow, createRng, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { buildStartingPoint } from '../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, TRACK, upstreamOf } from '../shared/forecast-field/support.ts';
import { drawn, interaction, noStops, PLAIN, startingPoint, traceAt, type CarSpec } from './start.ts';

const LAP = 10;
const LAPS_TOTAL = 20;
const STOP_LAP = 12;
const LOSS_MS = 22_000;
const MIN_GAP_MS = 500;

const run = (start: StartingPoint, policies: readonly Policy[], scenario = PLAIN) => raceForecast(start, policies, scenario, createRng(42), { trace: true });

const stops: Policy = { stops: [{ lap: STOP_LAP, compound: 'hard' }], triggers: [] };
const staysOut: Policy = { stops: [], triggers: [] };

/** The stopper (car 0) at gap 0 and the cars `22 s + d` behind it for each `d` of `behindRejoinMs`. */
function field(behindRejoinMs: number[], minGapMs = MIN_GAP_MS): StartingPoint {
  const cars: CarSpec[] = [{ gapMs: 0 }, ...behindRejoinMs.map((d) => ({ gapMs: LOSS_MS + d }))];
  // no DRS zone: a car within DRS range of the stopper would close up on it
  return startingPoint({ lap: LAP, lapsTotal: LAPS_TOTAL, cars, drsZones: [], interaction: interaction({ curve: { cap: 0 }, minGapMs }), pitLossMs: { green: LOSS_MS, vsc: 13_000, sc: 11_000, inLapShare: 0 } });
}

/** The stopper alone: its race time with nobody to yield to. */
const aloneMs = (minGapMs = MIN_GAP_MS, scenario = PLAIN): number => run(field([], minGapMs), [stops], scenario).raceTimeMs[0]!;

/** How much longer the stopper's race is with a stayed-out car `d` behind its rejoin than alone. */
const growthMs = (d: number, minGapMs = MIN_GAP_MS): number => run(field([d], minGapMs), [stops, staysOut]).raceTimeMs[0]! - aloneMs(minGapMs);

describe('race-forecast: the pit-exit yield (SP4.3b Task 11h)', () => {
  // row 1
  it('a stopper rejoining 300 ms ahead of a stayed-out car rejoins minGapMs behind it', () => {
    const start = field([300]);
    for (const scenario of [PLAIN, drawn(1), drawn(2), drawn(3)]) {
      const r = run(start, [stops, staysOut], scenario);
      const out = traceAt(r, STOP_LAP + 1);
      // behind the stayed-out car, held at the minimum gap
      expect(out.position[0]).toBe(2);
      expect(out.position[1]).toBe(1);
      expect(Math.abs(out.gapMs[0]! - out.gapMs[1]! - MIN_GAP_MS)).toBeLessThanOrEqual(1);
      expect(r.position[0]).toBe(2);
      // it rejoins at t_o + minGapMs: 300 + 500 ms later than alone
      expect(Math.abs(r.raceTimeMs[0]! - aloneMs(MIN_GAP_MS, scenario) - (300 + MIN_GAP_MS))).toBeLessThanOrEqual(1);
      // and the stayed-out car is not held by it: its race as if the stopper never stopped
      expect(Math.abs(r.raceTimeMs[1]! - run(start, noStops(2), scenario).raceTimeMs[1]!)).toBeLessThanOrEqual(1);
    }
  });

  // row 2
  it('a stopper rejoining 700 ms ahead (more than minGapMs) keeps its place', () => {
    const r = run(field([700]), [stops, staysOut]);
    const out = traceAt(r, STOP_LAP + 1);
    expect(out.position[0]).toBe(1);
    expect(out.position[1]).toBe(2);
    expect(Math.abs(out.gapMs[1]! - out.gapMs[0]! - 700)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.raceTimeMs[0]! - aloneMs())).toBeLessThanOrEqual(1);
  });

  // row 3
  it('the stopper yields once: with two stayed-out cars inside the window it ends behind the first only', () => {
    // two followers are held minGapMs apart, so both cannot cross inside one window [T, T + 500): the first crosses at
    // T + 300; the second at T + 1000, inside the window the yield opens [T + 800, T + 1300). A cascade would yield to it too.
    const r = run(field([300, 1_000]), [stops, staysOut, staysOut]);
    const out = traceAt(r, STOP_LAP + 1);
    expect([out.position[1], out.position[0], out.position[2]]).toEqual([1, 2, 3]);
    expect(Math.abs(out.gapMs[0]! - out.gapMs[1]! - MIN_GAP_MS)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.raceTimeMs[0]! - aloneMs() - (300 + MIN_GAP_MS))).toBeLessThanOrEqual(1);
    expect(Array.from(r.position)).toEqual([2, 1, 3]);
  });

  // row 4
  it('a car that also stops on that lap is not yielded to', () => {
    // the second car crosses the line 300 ms after the stopper's rejoin time, but enters the pits there too
    const r = run(field([300]), [stops, stops]);
    const out = traceAt(r, STOP_LAP + 1);
    expect(out.position[0]).toBe(1);
    expect(Math.abs(r.raceTimeMs[0]! - aloneMs())).toBeLessThanOrEqual(1);
  });

  // row 5
  it('the total race time of the stopper grows by at most minGapMs from the yield', () => {
    // the yield moves its rejoin from T to t_o + minGapMs: minGapMs past the stayed-out car's crossing at T + d, so the
    // growth is d + minGapMs inside the window [T, T + minGapMs) and nothing outside it; the window is minGapMs itself
    for (const minGapMs of [300, 500, 800]) {
      for (const d of [1, 100, minGapMs / 2, minGapMs - 1]) {
        const growth = growthMs(d, minGapMs);
        expect(growth - d).toBeGreaterThanOrEqual(minGapMs - 1);
        expect(growth - d).toBeLessThanOrEqual(minGapMs + 1);
      }
      for (const d of [minGapMs + 1, minGapMs + 200, 2_000]) expect(Math.abs(growthMs(d, minGapMs))).toBeLessThanOrEqual(1);
    }
  });
});

describe('race-forecast: the pit-exit yield, rewind (SP4.3b Task 11h R1)', () => {
  it('rewind: output equals a run without the undone frames (C33)', () => {
    // forecast-field's build at lap 8's first frame, after a rewind from lap 11
    const g = generated();
    const target = g.race.framesOfLap(8)[0]!;
    const undone = g.race.framesOfLap(11)[0]!;
    const rewoundView: EngineView = { ...g.race.viewAt(target, { from: undone }), track: TRACK };
    expect(rewoundView.delta.rewound).toBeDefined();
    const build = (now: EngineView): StartingPoint => {
      const view = materialised(asOfNow(now));
      const sp = buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, [6, 7], view.at)));
      if (!sp.known) throw new Error(`the starting point is unknown (${sp.reason})`);
      return sp.value;
    };
    const rewound = build(rewoundView);
    const fresh = build(g.viewAt(target));
    expect(rewound).toEqual(fresh);
    // every other car stops at the end of lap 8, so stoppers rejoin among cars that stayed out
    const policies: Policy[] = Array.from({ length: rewound.cars }, (_, c) => (c % 2 === 0 ? { stops: [{ lap: 8, compound: 'hard' as const }], triggers: [] } : staysOut));
    for (const scenario of [PLAIN, drawn(1)]) expect(run(rewound, policies, scenario)).toEqual(run(fresh, policies, scenario));
  });
});
