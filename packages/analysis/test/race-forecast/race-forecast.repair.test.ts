// SP4.3b Task 6 (spec §4.2 F2 and F7; C2, C43, C47, C50): the forecast repair's two fixes in `race-forecast` and
// `forecast-field`.
//
// F2: a stop's loss is split between the in-lap and the out-lap. `forecast-field` fills `track.pitLossMs.inLapShare`
// from `pit-loss`'s in-lap share (ported in SP4.3b Task 11c: before, forecast-field's config `inLapLossShare`; now
// pit-loss's measured share, whose prior is its config's `inLapShare` 0.26 = 5.5 / 21.5 s, research 12 §5, and which is
// that prior before any stop is measured, as at lap 6 and lap 8 of the generator race); `race-forecast` adds `inLapShare × loss` to
// the stopping car's in-lap (before the line) and the rest after the line. The test agent's reading of row 3 (no
// `StartingPoint` field marks a car in the pit lane): a car whose in-lap is done at the start is a car that has just
// crossed the line ending lap L − 1 (lap fraction 0 on lap L) whose policy holds a stop at the end of lap L − 1; the
// forecast charges it the out-lap part only.
//
// F7: one DRS rule. `forecast-field` fills `start.drs` from `race-interaction`'s config (`drsRangeMs`, `drsFromLap`);
// `race-forecast` reads `start.drs` and keeps no copy in its constants.
//
// Hand-built starting points come from `start.ts`; the `forecast-field` builds from the generator race of its tests
// (`test/shared/forecast-field/support.ts`), as its stand-ins rows build them.
import type { Known, Policy, StartingPoint } from '@pitwall/domain';
import { asOfNow, createRng, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import * as constants from '../../src/race-forecast/constants.ts';
import { raceForecast } from '../../src/race-forecast/index.ts';
import { RACE_INTERACTION_CONFIG } from '../../src/race-interaction/config.ts';
import { PIT_LOSS_CONFIG } from '../../src/pit-loss/index.ts';
import { buildStartingPoint } from '../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, TRACK, upstreamOf, type Generated } from '../shared/forecast-field/support.ts';
import { interaction, noStops, PACE_MS, PLAIN, startingPoint, traceAt } from './start.ts';

const run = (start: StartingPoint, policies: readonly Policy[], toLap?: number) =>
  raceForecast(start, policies, PLAIN, createRng(42), { trace: true, ...(toLap !== undefined && { toLap }) });

/** Row 1's loss and share: F1 25's green stop, about 5.5 s on the in-lap and 16 s on the out-lap (research 12 §5). */
const LOSS_MS = 21_500;
const SHARE = 0.26;
const IN_LAP_MS = SHARE * LOSS_MS; // 5,590
const OUT_LAP_MS = LOSS_MS - IN_LAP_MS; // 15,910
const PIT_LOSS = { green: LOSS_MS, vsc: 13_000, sc: 11_000, inLapShare: SHARE };

// ---- forecast-field builds on the generator race (built once, on first use) ----

/** The generator race's human cars: slots 6 and 7. */
const HUMANS = [6, 7];
let race: Generated | undefined;
const gen = (): Generated => (race ??= generated());

function valueOf(sp: Known<StartingPoint>, what: string): StartingPoint {
  if (!sp.known) throw new Error(`${what}: the starting point is unknown (${sp.reason})`);
  return sp.value;
}

/** forecast-field's live build at `view` with `config` on top of the view's. */
function buildAt(now: EngineView, config: AsOfView['config'] = {}): StartingPoint {
  const base = materialised(asOfNow(now));
  const view = { ...base, config: { ...base.config, ...config } };
  return valueOf(buildStartingPoint(view, upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at))), 'build');
}

/** The build after lap 6's first frame. */
const buildAtLap6 = (config: AsOfView['config'] = {}): StartingPoint => buildAt(gen().viewAt(gen().race.framesOfLap(6)[0]!), config);

describe('race-forecast: the pit loss split (SP4.3b F2)', () => {
  // row 1
  it('a stop puts inLapShare of the loss on the in-lap and the rest on the out-lap; the total is unchanged', () => {
    // forecast-field fills the share from pit-loss's, before any measured stop its config's prior (0.26 by default; an
    // override is followed). Ported in SP4.3b Task 11c: the override was forecast-field's `inLapLossShare`.
    expect(buildAtLap6().track.pitLossMs.inLapShare).toBeCloseTo(SHARE, 9);
    expect(buildAtLap6({ [PIT_LOSS_CONFIG.key]: { inLapShare: 0.4 } }).track.pitLossMs.inLapShare).toBeCloseTo(0.4, 9);

    // one quiet car, equal laps; it stops at the end of lap 10 (its in-lap), lap 11 is its out-lap
    const start = startingPoint({ lap: 1, lapsTotal: 20, cars: [{ gapMs: 0 }], pitLossMs: PIT_LOSS });
    const stop: Policy = { stops: [{ lap: 10, compound: 'medium' }], triggers: [] };
    const without = run(start, noStops(1));
    const withStop = run(start, [stop]);
    const lapDelta = (lap: number): number => traceAt(withStop, lap).lapTimeMs[0]! - traceAt(without, lap).lapTimeMs[0]!;
    expect(Math.abs(lapDelta(10) - IN_LAP_MS)).toBeLessThanOrEqual(1);
    expect(Math.abs(lapDelta(11) - OUT_LAP_MS)).toBeLessThanOrEqual(1);
    for (const lap of [9, 12]) expect(Math.abs(lapDelta(lap))).toBeLessThanOrEqual(1);
    expect(Math.abs(withStop.raceTimeMs[0]! - without.raceTimeMs[0]! - LOSS_MS)).toBeLessThanOrEqual(1);
  });

  // row 2
  it('the race time with a stop is the same as before the split', () => {
    // three cars 35 s apart (no car meets another), one stop each: the split moves time, it adds none
    const cars = [0, 35_000, 70_000].map((gapMs) => ({ gapMs }));
    const policies: Policy[] = [8, 11, 14].map((lap) => ({ stops: [{ lap, compound: 'hard' as const }], triggers: [] }));
    const split = run(startingPoint({ lap: 1, lapsTotal: 20, cars, pitLossMs: PIT_LOSS }), policies);
    const before = run(startingPoint({ lap: 1, lapsTotal: 20, cars, pitLossMs: { ...PIT_LOSS, inLapShare: 0 } }), policies);
    for (const car of [0, 1, 2]) expect(Math.abs(split.raceTimeMs[car]! - before.raceTimeMs[car]!)).toBeLessThanOrEqual(1);
    // the leader from the line on lap 1: 20 laps and one loss
    expect(Math.abs(split.raceTimeMs[0]! - (20 * PACE_MS + LOSS_MS))).toBeLessThanOrEqual(1);
  });

  // row 3
  it('a car already in the pit lane at the start pays only the out-lap part', () => {
    // the car has just crossed the line ending lap 4 in the pit lane (its in-lap done, its stop at the end of lap 4)
    const start = startingPoint({ lap: 5, lapsTotal: 20, cars: [{ gapMs: 0 }], pitLossMs: PIT_LOSS });
    const inPit: Policy = { stops: [{ lap: 4, compound: 'hard' }], triggers: [] };
    const without = run(start, noStops(1));
    const r = run(start, [inPit]);
    expect(Math.abs(traceAt(r, 5).lapTimeMs[0]! - traceAt(without, 5).lapTimeMs[0]! - OUT_LAP_MS)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.raceTimeMs[0]! - without.raceTimeMs[0]! - OUT_LAP_MS)).toBeLessThanOrEqual(1);
  });
});

describe('race-forecast: one DRS rule (SP4.3b F7)', () => {
  // row 4
  it("an override of race-interaction's drsRangeMs changes the forecast's DRS", () => {
    // forecast-field takes the rule from race-interaction's config
    const defaults = buildAtLap6();
    expect(defaults.drs).toEqual({ rangeMs: RACE_INTERACTION_CONFIG.defaults.drsRangeMs, fromLap: RACE_INTERACTION_CONFIG.defaults.drsFromLap });
    expect(buildAtLap6({ [RACE_INTERACTION_CONFIG.key]: { drsRangeMs: 800, drsFromLap: 5 } }).drs).toEqual({ rangeMs: 800, fromLap: 5 });
    // and race-forecast keeps no copy of it
    expect(Object.keys(constants)).not.toContain('DRS_RANGE_MS');
    expect(Object.keys(constants)).not.toContain('DRS_FROM_LAP');

    // race-forecast reads start.drs: a follower 900 ms behind at the detection point, equal pace, no passes
    const base = startingPoint({
      lap: 10,
      lapsTotal: 30,
      cars: [{ gapMs: 0 }, { gapMs: 900 }],
      interaction: interaction({ curve: { cap: 0 }, minGapMs: 200, drsStraightGainMs: 250 }),
    });
    const gapAfterLap10 = (drs: StartingPoint['drs']): number => traceAt(run({ ...base, drs }, noStops(2), 10), 10).gapMs[1]!;
    // 800 ms: out of range, no gain; 1,000 ms: in range, the straight gain once
    expect(Math.abs(gapAfterLap10({ rangeMs: 800, fromLap: 3 }) - 900)).toBeLessThanOrEqual(1);
    expect(Math.abs(gapAfterLap10({ rangeMs: 1_000, fromLap: 3 }) - (900 - 250))).toBeLessThanOrEqual(1);
    // the first DRS lap is start.drs's too: from lap 12, lap 10 has none
    expect(Math.abs(gapAfterLap10({ rangeMs: 1_000, fromLap: 12 }) - 900)).toBeLessThanOrEqual(1);
  });
});

describe('race-forecast and forecast-field: rewind (SP4.3b R1)', () => {
  it('rewind: output equals a run without the undone frames (C33)', () => {
    const g = gen();
    const target = g.race.framesOfLap(8)[0]!;
    const undone = g.race.framesOfLap(11)[0]!;
    const rewoundView: EngineView = { ...g.race.viewAt(target, { from: undone }), track: TRACK };
    expect(rewoundView.delta.rewound).toBeDefined();
    // ported in SP4.3b Task 11c: the share's override was forecast-field's `inLapLossShare`, now pit-loss's prior
    const config = { [PIT_LOSS_CONFIG.key]: { inLapShare: 0.3 }, [RACE_INTERACTION_CONFIG.key]: { drsRangeMs: 800 } };
    const rewound = buildAt(rewoundView, config);
    const fresh = buildAt(g.viewAt(target), config);
    // the rewound build carries the config's split and DRS rule, and equals the build that never saw the undone frames
    expect(rewound.track.pitLossMs.inLapShare).toBeCloseTo(0.3, 9);
    expect(rewound.drs.rangeMs).toBe(800);
    expect(rewound).toEqual(fresh);
    // and so does the forecast from it, a stop included
    const policies: Policy[] = Array.from({ length: rewound.cars }, (_, k) => ({ stops: [{ lap: 12 + (k % 3), compound: 'hard' as const }], triggers: [] }));
    expect(run(rewound, policies)).toEqual(run(fresh, policies));
  });
});
