// SP4.3b Task 11a (spec §4 F8, cause 1 of the Task 11 root-cause findings; C2, C33, C50): a car the forecast places
// just after its line is not counted as crossing that line again.
//
// The defect: `place()` puts a car at lap fraction ≈ 0 on lap L (it has just crossed the line ending lap L − 1) before
// the lap's first point, and sets its line time of lap L − 1. While any car is still on lap L − 1, the loop steps the
// line ending lap L − 1, and `crossLine` counted the placed car as crossing it again: one more lap of wear and fuel,
// its lap L restarted, and on an in-lap the in-lap share of the loss charged twice (and the cars behind it held by
// that extra time). It hits every rejoin and undercut case `forecast-score` predicts from the stopper's own lap s − 1
// crossing (fraction ≈ 0.0002) and every live starting point with a car just past its line.
//
// Hand-built starting points come from `start.ts` (the builder; no recording, C84): the cars' lap fractions are set
// directly, so a car is just past its line while the cars behind it are still on the lap before.
import type { Policy, StartingPoint } from '@pitwall/domain';
import { asOfNow, createRng, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { buildStartingPoint } from '../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, TRACK, upstreamOf } from '../shared/forecast-field/support.ts';
import { drawn, interaction, LAP_MODEL, noStops, PACE_MS, PLAIN, startingPoint, traceAt, type CarSpec } from './start.ts';

const run = (start: StartingPoint, policies: readonly Policy[], scenario = PLAIN) => raceForecast(start, policies, scenario, createRng(42), { trace: true });

/** About 18 ms past the line at 90 s a lap: where `forecast-score` starts a stopper, at its own lap s − 1 crossing. */
const JUST_PAST = 0.0002;
const LAP = 10;
const LAPS_TOTAL = 20;

/** The field of `cars` (`cars[0]` leads) with every car's lap fraction set: a fraction above the leader's is the lap before. */
function field(cars: CarSpec[], fractions: number[], o: Partial<Parameters<typeof startingPoint>[0]> = {}): StartingPoint {
  const start = startingPoint({ lap: LAP, lapsTotal: LAPS_TOTAL, interaction: interaction({ curve: { cap: 0 } }), ...o, cars });
  return { ...start, lapFraction: Float64Array.from(fractions) };
}

/** Row 2's loss and share (as the F2 rows: 5,590 ms on the in-lap, 15,910 ms on the out-lap). */
const LOSS_MS = 21_500;
const SHARE = 0.26;
const IN_LAP_MS = SHARE * LOSS_MS;
const PIT_LOSS = { green: LOSS_MS, vsc: 13_000, sc: 11_000, inLapShare: SHARE };

const stopAtEndOf = (lap: number): Policy => ({ stops: [{ lap, compound: 'hard' }], triggers: [] });

describe('race-forecast: a car just past its line (SP4.3b Task 11a, F8 cause 1)', () => {
  // row 1
  it('a car placed just after its line (lap fraction ≈ 0) is not counted as crossing that line again: no extra lap of wear or fuel, its lap not restarted', () => {
    // the leader just past the line starting lap 10, on a new set; a car 2 s behind it still on lap 9
    const lapModel = { ...LAP_MODEL, fuelMsPerKg: 30, coldTyreMs: [400, 200] as [number, number] };
    const leader: CarSpec = { gapMs: 0, degMsPerLap: 50, wearRatePct: 2, wearPct: 10, fuelKg: 40, tyreAge: 0 };
    const withFollower = field([leader, { gapMs: 2_000 }], [JUST_PAST, 1 - 2_000 / PACE_MS], { lapModel });
    const alone = field([leader], [JUST_PAST], { lapModel });
    const r = run(withFollower, noStops(2));

    // lap 10 from the start's wear (10 %), fuel (40 kg) and first lap on the set: 90,000 + 500 + 1,200 + 400 ms
    expect(Math.abs(traceAt(r, LAP).lapTimeMs[0]! - 92_100)).toBeLessThanOrEqual(1);
    // lap 11 after exactly one lap of wear (12 %) and of fuel (40 kg over the 11 − 0.0002 laps left), second lap on the set
    const burnKg = 40 / (LAPS_TOTAL - LAP + 1 - JUST_PAST);
    expect(Math.abs(traceAt(r, LAP + 1).lapTimeMs[0]! - (PACE_MS + 50 * 12 + 30 * (40 - burnKg) + 200))).toBeLessThanOrEqual(1);
    // every lap of the leader is the lap it runs with nobody behind it (no car on the lap before: no line crossed again)
    const ref = run(alone, noStops(1));
    for (let lap = LAP; lap <= LAPS_TOTAL; lap++) expect(Math.abs(traceAt(r, lap).lapTimeMs[0]! - traceAt(ref, lap).lapTimeMs[0]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.raceTimeMs[0]! - ref.raceTimeMs[0]!)).toBeLessThanOrEqual(1);

    // its lap 10 is not restarted: a drawn scenario's first lap keeps its stationary scatter (the run alone's draws)
    const noisy: CarSpec = { ...leader, sigmaMs: 300, rho: 0.5 };
    const drawnWith = field([noisy, { gapMs: 2_000 }], [JUST_PAST, 1 - 2_000 / PACE_MS], { lapModel });
    const drawnAlone = field([noisy], [JUST_PAST], { lapModel });
    for (const id of [1, 2, 3]) {
      const a = run(drawnWith, noStops(2), drawn(id));
      const b = run(drawnAlone, noStops(1), drawn(id));
      for (let lap = LAP; lap <= LAPS_TOTAL; lap++) expect(Math.abs(traceAt(a, lap).lapTimeMs[0]! - traceAt(b, lap).lapTimeMs[0]!)).toBeLessThanOrEqual(1);
    }
  });

  // row 2
  it('a stopper predicted from its own lap s−1 crossing pays the in-lap share once', () => {
    // the stopper (car 1) just past the line starting lap 10, stopping at its end; the leader 2.7 s ahead on lap 10,
    // a car 2 s behind on lap 9; equal pace, no passes
    const cars: CarSpec[] = [{ gapMs: 0 }, { gapMs: 2_700 }, { gapMs: 4_700 }];
    const start = field(cars, [0.03, JUST_PAST, 1 - 2_000 / PACE_MS], { pitLossMs: PIT_LOSS });
    const policies = noStops(3);
    policies[1] = stopAtEndOf(LAP);
    const without = run(start, noStops(3));
    const withStop = run(start, policies);
    // at the line ending its in-lap: the in-lap share once, on its gap to the leader
    expect(Math.abs(traceAt(withStop, LAP).gapMs[1]! - traceAt(without, LAP).gapMs[1]! - IN_LAP_MS)).toBeLessThanOrEqual(1);
    // and the race: the stop's whole loss once
    expect(Math.abs(withStop.raceTimeMs[1]! - without.raceTimeMs[1]! - LOSS_MS)).toBeLessThanOrEqual(1);

    // the same when the stopper leads
    const leading = field([{ gapMs: 0 }, { gapMs: 2_000 }], [JUST_PAST, 1 - 2_000 / PACE_MS], { pitLossMs: PIT_LOSS });
    const leads = run(leading, [stopAtEndOf(LAP), { stops: [], triggers: [] }]);
    const leadsWithout = run(leading, noStops(2));
    expect(Math.abs(leads.raceTimeMs[0]! - leadsWithout.raceTimeMs[0]! - LOSS_MS)).toBeLessThanOrEqual(1);
  });

  // row 3
  it("cars behind a stopper lose no time on the stop lap from the stopper's start", () => {
    // the stopper leads, just past the line starting lap 10 and stopping at its end; two cars 2 s and 4 s behind it on
    // lap 9, equal pace: each one's stop lap and the lap after are its green lap
    const start = field([{ gapMs: 0 }, { gapMs: 2_000 }, { gapMs: 4_000 }], [JUST_PAST, 1 - 2_000 / PACE_MS, 1 - 4_000 / PACE_MS], { pitLossMs: PIT_LOSS });
    const policies = noStops(3);
    policies[0] = stopAtEndOf(LAP);
    const r = run(start, policies);
    for (const car of [1, 2]) {
      for (const lap of [LAP, LAP + 1]) expect(Math.abs(traceAt(r, lap).lapTimeMs[car]! - PACE_MS)).toBeLessThanOrEqual(1);
    }
  });
});

describe('race-forecast: a car just past its line, rewind (SP4.3b Task 11a R1)', () => {
  it('rewind: output equals a run without the undone frames (C33)', () => {
    // forecast-field's build at lap 8's first frame (the leader just past its line), after a rewind from lap 11
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
    // every car stops at the end of lap 8: its in-lap is the lap the forecast starts on
    const policies: Policy[] = Array.from({ length: rewound.cars }, () => stopAtEndOf(8));
    expect(run(rewound, policies)).toEqual(run(fresh, policies));
  });
});
