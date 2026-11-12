// The forecast's field (spec 6.3): every car's state as typed arrays, and what happens at a car's line: its lap ends
// (wear, fuel, a stop's new set) and its next lap starts (its lap time from `lap-model`, its draws for that lap).
import { NOISE_COMPOUNDS, type LapInput, type NoiseCompound, type Policy, type Scenario, type StartingPoint } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { BIG_EVENT_MAX_MS, BIG_EVENT_MIN_MS } from './constants.ts';
import { normal, PURPOSE, streamKey, uniform, type Draws } from './draws.ts';

/** A lap's neutralisation, by index: none, VSC, SC (SC wins where a scenario lists both). */
export const NEUTRAL = { none: 0, vsc: 1, sc: 2 } as const;
const NEUTRAL_KIND = ['none', 'vsc', 'sc'] as const;

// The per-lap imports, bound once (a module runner reads an import from its namespace on every use; spec 10's budget).
const lapTime = lapTimeMs;
const compounds = NOISE_COMPOUNDS;
const keyOf = streamKey;
const uniformDraw = uniform;
const normalDraw = normal;
const SCATTER = PURPOSE.scatter;
const MISTAKE = PURPOSE.mistake;
const BIG_EVENT = PURPOSE.bigEvent;
const RETIRE = PURPOSE.retire;
const BIG_MIN_MS = BIG_EVENT_MIN_MS;
const BIG_SPAN_MS = BIG_EVENT_MAX_MS - BIG_EVENT_MIN_MS;

/** A car that does not retire on this lap. */
export const NO_RETIREMENT = 2;

export type Field = {
  start: StartingPoint;
  policies: readonly Policy[];
  plain: boolean;
  draws: Draws;
  /** Per lap number: its neutralisation (`NEUTRAL`), and the common lap time of a VSC lap (the first car to start it). */
  neutralByLap: Uint8Array;
  vscLapMs: Float64Array;
  /** The last lap the forecast runs. */
  endLap: number;
  // per car: where it is
  lap: Int16Array;
  /** The next point it reaches (global: lap × points a lap + the point's index) and its time at its last point. */
  gNext: Int32Array;
  tLast: Float64Array;
  /** Its line times by lap number (`lineIndex`; NaN until it crosses that line). */
  lineT: Float64Array;
  running: Uint8Array;
  /** The lap fraction at which it retires on this lap (`NO_RETIREMENT`: it does not). */
  retireAt: Float64Array;
  // per car: the lap it is on
  lapMs: Float64Array;
  greenMs: Float64Array;
  neutral: Uint8Array;
  inLap: Uint8Array;
  // per car: the scenario's draws and its car
  paceMs: Float64Array;
  degMs: Float64Array;
  scatterMs: Float64Array;
  compound: Uint8Array;
  wearPct: Float64Array;
  fuelKg: Float64Array;
  burnKg: Float64Array;
  lapOnSet: Int16Array;
  /** Our cars' sets fitted so far, per car and compound index. */
  setsUsed: Map<number, Int16Array>;
  // per car: following
  hazard: Float64Array;
  heldBy: Int16Array;
  drsRange: Uint8Array;
  drsPass: Uint8Array;
};

/** One reused lap-model input: the forecast calls the lap model once per car and lap. */
const input: LapInput = { paceMs: 0, degMsPerLap: 0, wearPct: 0, fuelKg: 0, compound: 'medium', lapOnSet: 1, neutralised: 'none', wetnessMs: 0, scatterMs: 0, mistakeMs: 0 };

export function createField(start: StartingPoint, policies: readonly Policy[], scenario: Scenario, draws: Draws, endLap: number): Field {
  const n = start.cars;
  const laps = start.lapsTotal + 2;
  const neutralByLap = new Uint8Array(laps);
  for (const x of scenario.neutralisations) {
    for (let l = Math.max(0, x.fromLap); l <= Math.min(laps - 1, x.toLap); l++) neutralByLap[l] = Math.max(neutralByLap[l] ?? 0, NEUTRAL[x.kind]);
  }
  const f: Field = {
    start,
    policies,
    plain: scenario.plain,
    draws,
    neutralByLap,
    vscLapMs: new Float64Array(laps).fill(Number.NaN),
    endLap,
    lap: new Int16Array(n),
    gNext: new Int32Array(n),
    tLast: new Float64Array(n),
    lineT: new Float64Array(n * laps).fill(Number.NaN),
    running: new Uint8Array(n),
    retireAt: new Float64Array(n).fill(NO_RETIREMENT),
    lapMs: new Float64Array(n),
    greenMs: new Float64Array(n),
    neutral: new Uint8Array(n),
    inLap: new Uint8Array(n),
    paceMs: new Float64Array(n),
    degMs: new Float64Array(n),
    scatterMs: new Float64Array(n),
    compound: Uint8Array.from(start.compound),
    wearPct: Float64Array.from(start.wearPct),
    fuelKg: Float64Array.from(start.fuelKg),
    burnKg: new Float64Array(n),
    lapOnSet: new Int16Array(n),
    setsUsed: new Map(Object.keys(start.sets).map((k) => [Number(k), new Int16Array(NOISE_COMPOUNDS.length)])),
    hazard: new Float64Array(n),
    heldBy: new Int16Array(n).fill(-1),
    drsRange: new Uint8Array(n),
    drsPass: new Uint8Array(n),
  };
  for (let c = 0; c < n; c++) {
    f.running[c] = start.retired[c] === 1 ? 0 : 1;
    // pace level and degradation, drawn once per scenario around their σ (spec 6.3)
    const key = keyOf(draws, c, 0);
    f.paceMs[c] = (start.paceMs[c] ?? 0) + (scenario.plain ? 0 : (start.paceSdMs[c] ?? 0) * normalDraw(key, PURPOSE.pace, 0));
    f.degMs[c] = (start.degMsPerLap[c] ?? 0) + (scenario.plain ? 0 : (start.degSdMs[c] ?? 0) * normalDraw(key, PURPOSE.deg, 0));
    f.lapOnSet[c] = (start.tyreAge[c] ?? 0) + 1;
  }
  return f;
}

export const lineIndex = (f: Field, car: number, lap: number): number => car * (f.start.lapsTotal + 2) + lap;

/** Car `c`'s stop at the end of lap `lap`, if its policy has one there (never at or after the flag). */
function stopAt(f: Field, c: number, lap: number): { lap: number; compound: NoiseCompound } | undefined {
  const stops = f.policies[c]?.stops;
  if (stops === undefined || lap >= f.start.lapsTotal) return undefined;
  for (const stop of stops) if (stop.lap === lap) return stop;
  return undefined;
}

/** Car `c` starts lap `lap` (`fromFraction`: where it is on that lap, 0 at its line); `first`: its first lap of the forecast. */
export function startLap(f: Field, c: number, lap: number, fromFraction: number, first: boolean): void {
  const s = f.start;
  const kind = f.neutralByLap[Math.min(lap, f.neutralByLap.length - 1)] ?? NEUTRAL.none;
  f.lap[c] = lap;
  f.neutral[c] = kind;
  f.inLap[c] = stopAt(f, c, lap) === undefined ? 0 : 1;
  input.paceMs = f.paceMs[c] ?? 0;
  input.degMsPerLap = f.degMs[c] ?? 0;
  input.wearPct = f.wearPct[c] ?? 0;
  input.fuelKg = f.fuelKg[c] ?? 0;
  input.compound = compounds[f.compound[c] ?? 0] ?? 'medium';
  input.lapOnSet = f.lapOnSet[c] ?? 1;
  input.wetnessMs = s.wetness.wetnessMs;
  input.neutralised = 'none';
  const green = lapTime(s.lapModel, input);
  f.greenMs[c] = green;
  f.retireAt[c] = NO_RETIREMENT;
  let noiseMs = 0;
  if (!f.plain) {
    const key = keyOf(f.draws, c, lap);
    const sigma = s.sigmaMs[c] ?? 0;
    const rho = s.rho[c] ?? 0;
    const z = normalDraw(key, SCATTER, 0);
    // AR(1) with the marginal σ: a stationary first lap, then ρ of the last lap's scatter plus the innovation
    const scatter = first ? sigma * z : rho * (f.scatterMs[c] ?? 0) + Math.sqrt(1 - rho * rho) * sigma * z;
    f.scatterMs[c] = scatter;
    if (kind === NEUTRAL.none) {
      noiseMs += scatter;
      if (uniformDraw(key, MISTAKE, 0) < (s.mistakeRate[c] ?? 0)) noiseMs += (s.mistakeMedianMs[c] ?? 0) * Math.exp((s.mistakeSigmaLog[c] ?? 0) * normalDraw(key, MISTAKE, 1));
      // a big slow lap (P5: apart from retirements, and never one)
      if (uniformDraw(key, BIG_EVENT, 0) < (s.bigEventRate[c] ?? 0)) noiseMs += BIG_MIN_MS + BIG_SPAN_MS * (1 - uniformDraw(key, BIG_EVENT, 1));
    }
    if (uniformDraw(key, RETIRE, 0) < (s.retireRate[c] ?? 0)) {
      const at = uniformDraw(key, RETIRE, 1);
      if (at >= fromFraction) f.retireAt[c] = at;
    }
  }
  if (kind === NEUTRAL.none) f.lapMs[c] = green + noiseMs;
  else {
    input.neutralised = NEUTRAL_KIND[kind] ?? 'none';
    if (kind === NEUTRAL.vsc) {
      // under VSC every car runs one lap time: the lap's first car's (the leader's)
      if (Number.isNaN(f.vscLapMs[lap] ?? Number.NaN)) f.vscLapMs[lap] = lapTime(s.lapModel, input);
      f.lapMs[c] = f.vscLapMs[lap] ?? 0;
    } else f.lapMs[c] = lapTime(s.lapModel, input);
  }
  if (first) {
    // fuel runs to empty at the flag
    const lapsLeft = s.lapsTotal - lap + 1 - fromFraction;
    f.burnKg[c] = lapsLeft > 0 ? (f.fuelKg[c] ?? 0) / lapsLeft : 0;
  }
}

/** Car `c` crossed the line ending lap `lap`: wear and fuel of the lap, a stop's new set; returns the stop's set if it stopped. */
export function endLap(f: Field, c: number, lap: number): NoiseCompound | undefined {
  const s = f.start;
  const kind = f.neutral[c] ?? NEUTRAL.none;
  const factors = kind === NEUTRAL.sc ? s.lapModel.neutralised.sc : kind === NEUTRAL.vsc ? s.lapModel.neutralised.vsc : undefined;
  f.wearPct[c] = (f.wearPct[c] ?? 0) + (s.wearRatePct[c] ?? 0) * (factors?.wearFactor ?? 1);
  f.fuelKg[c] = Math.max(0, (f.fuelKg[c] ?? 0) - (f.burnKg[c] ?? 0) * (factors?.fuelFactor ?? 1));
  f.lapOnSet[c] = (f.lapOnSet[c] ?? 0) + 1;
  const stop = f.inLap[c] === 1 ? stopAt(f, c, lap) : undefined;
  if (stop === undefined) return undefined;
  const k = NOISE_COMPOUNDS.indexOf(stop.compound);
  f.compound[c] = k;
  f.lapOnSet[c] = 1;
  f.wearPct[c] = 0;
  const used = f.setsUsed.get(c);
  if (used !== undefined) {
    // our car fits its next set of that compound, at that set's wear; a fresh set once none is left
    const sets = (s.sets[c as keyof typeof s.sets] ?? []).filter((x) => x.compound === stop.compound);
    const set = sets[used[k] ?? 0];
    if (set !== undefined) f.wearPct[c] = set.wearPct;
    used[k] = (used[k] ?? 0) + 1;
  }
  return stop.compound;
}
