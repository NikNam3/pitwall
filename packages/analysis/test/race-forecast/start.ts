// Starting points for `race-forecast`'s tests (Task 18), built by hand: `forecast-field` (Task 16) is the only builder
// in the product (C50), and these tests need fields it would never produce (a car held at exactly the minimum gap, a
// field 40 s apart, a car that retires every lap).
//
// What these starting points mean, as the simulator reads them (the test agent's decisions, Task 18 report):
// - Every array is indexed by car slot. `order[k]` is the car slot `k`-th from the front (`order[0]` leads); retired
//   cars come last.
// - `gapMs[car]` is the time the car is behind the leader on the road (the leader 0). `lapFraction[car]` is where the
//   car is on its own lap: a car whose fraction is above the leader's has not yet crossed the line the leader crossed
//   last, so it is on lap `lap - 1`. These starting points place the leader at `lapFraction` 0 on lap `lap` (on the
//   line) and every other car `gapMs` behind it at its own pace, as `forecast-field` does (spec 6.1).
// - `lap` is the leader's lap (1-based); the race runs to the end of lap `lapsTotal`.
// - The lap model's `degMsPerLap` is ms per % wear (ruling R18); a car's wear grows by `wearRatePct` a lap on every set.
// - `track.pitLossMs` is the whole loss of an AI car's stop (stationary time included); a human's stop is shorter.
// - The cars of `sets` are our team: they share one pit box (the double stack).
//
// And what a forecast returns, as these tests read it:
// - `position[car]` 1-based; 0 for a car retired before the flag (it keeps no position).
// - `raceTimeMs[car]`: from the starting point until the car crosses the line at the flag (or at the end of `toLap`).
// - `gapMs[car]`: the time it crosses that line after the leader.
// - `trace`: one entry per lap from `start.lap` on, each car as it completes that lap: its position, its gap to the
//   leader at that line and its lap time.
import { known, NOISE_COMPOUNDS, type CarId, type DrsZone, type ForecastResult, type ForecastTrace, type LapModelParams, type NoiseCompound, type PassCurve, type Policy, type RaceInteraction, type Scenario, type StartingPoint } from '@pitwall/domain';

export const PACE_MS = 90_000;

/** One car of a hand-built field. Every noise term defaults to 0, so a drawn scenario of such a field is quiet. */
export type CarSpec = {
  gapMs?: number;
  paceMs?: number;
  paceSdMs?: number;
  degMsPerLap?: number;
  degSdMs?: number;
  sigmaMs?: number;
  rho?: number;
  mistakeRate?: number;
  mistakeMedianMs?: number;
  mistakeSigmaLog?: number;
  bigEventRate?: number;
  retireRate?: number;
  wearRatePct?: number;
  compound?: NoiseCompound;
  tyreAge?: number;
  wearPct?: number;
  fuelKg?: number;
  human?: boolean;
  retired?: boolean;
};

/** A field's noise as the AI field's defaults (spec 8): scatter, correlation, mistakes, pace and degradation spread. */
export const NOISY: CarSpec = {
  paceSdMs: 150,
  degSdMs: 0.5,
  sigmaMs: 200,
  rho: 0.3,
  mistakeRate: 0.024,
  mistakeMedianMs: 700,
  mistakeSigmaLog: 0.6,
  bigEventRate: 0.005,
  retireRate: 0.001,
};

/** Every term zero or neutral but the neutralised paces (SC 1.4, VSC 1.3 times the green lap). */
export const LAP_MODEL: LapModelParams = {
  compoundOffsetMs: { soft: 0, medium: 0, hard: 0, inter: 0, wet: 0 },
  fuelMsPerKg: 0,
  convexFromPct: 40,
  convexMsPerPct2: 0,
  convexFlagged: true,
  coldTyreMs: [0, 0],
  coldTyreWetFactor: 1,
  neutralised: {
    sc: { paceFactor: 1.4, wearFactor: 0.3, fuelFactor: 0.5 },
    vsc: { paceFactor: 1.3, wearFactor: 0.4, fuelFactor: 0.6 },
  },
  wetnessMsPerMs: { slick: 0, inter: 0, wet: 0 },
};

export const CURVE: PassCurve = { level: -3, slopePerMs: 0.004, cap: 0.8, wetFactor: 1, drsFactor: 1.2 };

/** One DRS zone mid-lap, so a car never starts a forecast inside it. */
export const DRS_ZONES: DrsZone[] = [{ detection: 0.4, start: 0.45, end: 0.55 }];
export const BRAKING_ZONES = [0.1, 0.3, 0.6, 0.8];

export function interaction(o: { curve?: Partial<PassCurve>; minGapMs?: number; drsStraightGainMs?: number; drsPassFactor?: number } = {}): RaceInteraction {
  return {
    bands: [{ fromDifficulty: 0, toDifficulty: 110, curve: { ...CURVE, ...o.curve }, source: { kind: 'default', note: 'test', sessionShare: 0, parts: '' }, episodes: 0, passes: 0 }],
    band: known(0, 0),
    drsPassFactor: o.drsPassFactor ?? 1.2,
    drsStraightGainMs: o.drsStraightGainMs ?? 250,
    minGapMs: o.minGapMs ?? 500,
    heldLossMsPerLap: known(0, 0),
    rejoinPushBackMs: known(0, 0),
    dirtyAirMsPerLap: 0,
  };
}

export type StartSpec = {
  cars: CarSpec[];
  lap?: number;
  lapsTotal?: number;
  /** Our cars' slots (they share a pit box); each gets five fresh sets of every dry compound. */
  ours?: number[];
  interaction?: RaceInteraction;
  lapModel?: LapModelParams;
  pitLossMs?: { green: number; vsc: number; sc: number; inLapShare: number };
  drsZones?: DrsZone[];
  brakingZones?: number[];
};

const frac = (x: number): number => ((x % 1) + 1) % 1;

/** The field of `spec.cars` in the order given (`cars[0]` leads), each `gapMs` behind the leader (default 2 s a place). */
export function startingPoint(spec: StartSpec): StartingPoint {
  const cars = spec.cars.map((c, i) => ({ gapMs: 2_000 * i, paceMs: PACE_MS, ...c }));
  const n = cars.length;
  const f = <T extends Float64Array | Int16Array | Uint8Array>(make: (len: number) => T, of: (c: (typeof cars)[number]) => number): T => {
    const a = make(n);
    cars.forEach((c, i) => (a[i] = of(c)));
    return a;
  };
  const running = cars.map((c, i) => ({ c, i })).filter(({ c }) => c.retired !== true);
  const retired = cars.map((c, i) => ({ c, i })).filter(({ c }) => c.retired === true);
  const order = Int8Array.from([...running.sort((a, b) => a.c.gapMs - b.c.gapMs), ...retired].map(({ i }) => i));
  const sets: Record<CarId, { compound: NoiseCompound; wearPct: number }[]> = {};
  for (const slot of spec.ours ?? []) {
    sets[slot as CarId] = (['soft', 'medium', 'hard'] as const).flatMap((compound) => Array.from({ length: 5 }, () => ({ compound, wearPct: 0 })));
  }
  const lapsTotal = spec.lapsTotal ?? 30;
  return {
    lap: spec.lap ?? 1,
    lapsTotal,
    cars: n,
    order,
    gapMs: f((l) => new Float64Array(l), (c) => c.gapMs),
    lapFraction: f((l) => new Float64Array(l), (c) => frac(-c.gapMs / c.paceMs)),
    retired: f((l) => new Uint8Array(l), (c) => (c.retired === true ? 1 : 0)),
    human: f((l) => new Uint8Array(l), (c) => (c.human === true ? 1 : 0)),
    compound: f((l) => new Uint8Array(l), (c) => NOISE_COMPOUNDS.indexOf(c.compound ?? 'medium')),
    tyreAge: f((l) => new Int16Array(l), (c) => c.tyreAge ?? 0),
    wearPct: f((l) => new Float64Array(l), (c) => c.wearPct ?? 0),
    fuelKg: f((l) => new Float64Array(l), (c) => c.fuelKg ?? 0),
    paceMs: f((l) => new Float64Array(l), (c) => c.paceMs),
    paceSdMs: f((l) => new Float64Array(l), (c) => c.paceSdMs ?? 0),
    degMsPerLap: f((l) => new Float64Array(l), (c) => c.degMsPerLap ?? 0),
    degSdMs: f((l) => new Float64Array(l), (c) => c.degSdMs ?? 0),
    sigmaMs: f((l) => new Float64Array(l), (c) => c.sigmaMs ?? 0),
    rho: f((l) => new Float64Array(l), (c) => c.rho ?? 0),
    mistakeRate: f((l) => new Float64Array(l), (c) => c.mistakeRate ?? 0),
    mistakeMedianMs: f((l) => new Float64Array(l), (c) => c.mistakeMedianMs ?? 700),
    mistakeSigmaLog: f((l) => new Float64Array(l), (c) => c.mistakeSigmaLog ?? 0.6),
    bigEventRate: f((l) => new Float64Array(l), (c) => c.bigEventRate ?? 0),
    retireRate: f((l) => new Float64Array(l), (c) => c.retireRate ?? 0),
    wearRatePct: f((l) => new Float64Array(l), (c) => c.wearRatePct ?? 2),
    stopLow: f((l) => new Int16Array(l), () => lapsTotal),
    stopMid: f((l) => new Int16Array(l), () => lapsTotal),
    stopHigh: f((l) => new Int16Array(l), () => lapsTotal),
    owesStop: f((l) => new Uint8Array(l), () => 0),
    sets,
    wetness: { wetnessMs: 0, sdMs: 0 },
    track: {
      brakingZones: Float64Array.from(spec.brakingZones ?? BRAKING_ZONES),
      drsZones: spec.drsZones ?? DRS_ZONES,
      pitLossMs: spec.pitLossMs ?? { green: 22_000, vsc: 13_000, sc: 11_000, inLapShare: 0 },
    },
    drs: { rangeMs: 1_000, fromLap: 3 },
    interaction: spec.interaction ?? interaction(),
    lapModel: spec.lapModel ?? LAP_MODEL,
  };
}

export const PLAIN: Scenario = { id: 0, plain: true, neutralisations: [] };
export const drawn = (id: number, neutralisations: Scenario['neutralisations'] = []): Scenario => ({ id, plain: false, neutralisations });
export const plainWith = (neutralisations: Scenario['neutralisations']): Scenario => ({ id: 0, plain: true, neutralisations });

export const noStops = (n: number): Policy[] => Array.from({ length: n }, () => ({ stops: [], triggers: [] }));

/** The trace's entry of lap `lap`; throws when the forecast has none (the trace is part of what these tests check). */
export function traceAt(r: ForecastResult, lap: number): ForecastTrace[number] {
  const entry = r.trace?.find((t) => t.lap === lap);
  if (entry === undefined) throw new Error(`no trace entry for lap ${lap}`);
  return entry;
}
