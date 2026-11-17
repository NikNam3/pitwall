// The forecast's field (spec 6.3): every car's state as typed arrays, and what happens at a car's line: its lap ends
// (wear, fuel, a stop's new set) and its next lap starts (its lap time from `lap-model`, its draws for that lap).
import { NOISE_COMPOUNDS, tyreIndex, type LapInput, type NoiseCompound, type Policy, type Scenario, type StartingPoint } from '@pitwall/domain';
import { lapTimeMs } from '../lap-model/index.ts';
import { isWet } from '../track-wetness/wet.ts';
import { BIG_EVENT_MAX_MS, BIG_EVENT_MIN_MS } from './constants.ts';
import { drawLap, drawsInto, LAP_DRAW, LAP_DRAWS, normal, normalOf, PURPOSE, streamKey, streamOf, uniformOf, type Draws, type ScenarioDraws } from './draws.ts';

/** A lap's neutralisation, by index: none, VSC, SC (SC wins where a scenario lists both). */
export const NEUTRAL = { none: 0, vsc: 1, sc: 2 } as const;
const NEUTRAL_KIND = ['none', 'vsc', 'sc'] as const;

/**
 * The slots of a car's stepping state in `Field.car` (car `c` at `c × STRIDE`): what the point loop reads and writes
 * at every point, in one array so the loop loads few array headers (spec 10's budget). Integers and flags are stored
 * as doubles (exact).
 */
export const SLOT = {
  /** Its time at its last point. */
  tLast: 0,
  /** The next point it reaches (global: lap × points a lap + the point's index). */
  gNext: 1,
  /** The lap fraction at which it retires on this lap (`NO_RETIREMENT`: it does not). */
  retireAt: 2,
  /** The lap it is on: its lap time, its green lap time, its neutralisation (`NEUTRAL`), 1 on its in-lap. */
  lapMs: 3,
  greenMs: 4,
  neutral: 5,
  inLap: 6,
  /** Following: its summed pass hazard, the car holding it (-1: none), 1 in DRS range, 1 with a DRS pass chance. */
  hazard: 7,
  heldBy: 8,
  drsRange: 9,
  drsPass: 10,
} as const;
export const STRIDE = 16;

// The per-lap imports, bound once (a module runner reads an import from its namespace on every use; spec 10's budget).
const lapTime = lapTimeMs;
const compounds = NOISE_COMPOUNDS;
const tyreAt = tyreIndex;
const wetAt = isWet;
const keyOf = streamKey;
const streamAt = streamOf;
const uniformAt = uniformOf;
const normalAt = normalOf;
const normalDraw = normal;
const drawLapInto = drawLap;
const PACE = PURPOSE.pace;
const DEG = PURPOSE.deg;
const MISTAKE = PURPOSE.mistake;
const BIG_EVENT = PURPOSE.bigEvent;
const RETIRE = PURPOSE.retire;
const D = LAP_DRAWS;
const D_SCATTER = LAP_DRAW.scatter;
const D_MISTAKE = LAP_DRAW.mistake;
const D_BIG_EVENT = LAP_DRAW.bigEvent;
const D_RETIRE = LAP_DRAW.retire;
const BIG_MIN_MS = BIG_EVENT_MIN_MS;
const BIG_SPAN_MS = BIG_EVENT_MAX_MS - BIG_EVENT_MIN_MS;
const W = STRIDE;
const RETIRE_AT = SLOT.retireAt;
const LAP_MS = SLOT.lapMs;
const GREEN_MS = SLOT.greenMs;
const NEUTRAL_AT = SLOT.neutral;
const IN_LAP = SLOT.inLap;
const HELD_BY = SLOT.heldBy;

/** A car that does not retire on this lap. */
export const NO_RETIREMENT = 2;

export type Field = {
  start: StartingPoint;
  policies: readonly Policy[];
  plain: boolean;
  draws: Draws;
  /**
   * The scenario's draws every forecast of it reads alike (`ScenarioDraws`: per car the pace and degradation normals,
   * per car and lap at `lineIndex × LAP_DRAWS` the lap draws), NaN until drawn: the caller's table for this scenario
   * and seed, else this forecast's own.
   */
  paceZ: Float64Array;
  degZ: Float64Array;
  lapDraws: Float64Array;
  /** The scenario's wetness per lap from `start.lap` (`Scenario.wetnessByLap`); undefined: the starting point's on every lap. */
  wetnessByLap: Float64Array | undefined;
  /**
   * Per lap number: the wetness the lap model reads (`wetnessOn`) and 1 where the track is wet (`wetOn`), filled once
   * per forecast: every car starting a lap reads the same two values.
   */
  wetnessMsByLap: Float64Array;
  wetByLap: Uint8Array;
  /** Per lap number: its neutralisation (`NEUTRAL`), and the common lap time of a VSC lap (the first car to start it). */
  neutralByLap: Uint8Array;
  vscLapMs: Float64Array;
  /** The last lap the forecast runs. */
  endLap: number;
  /** Per car and lap number (`lineIndex`): the compound index of its policy's stop at the end of that lap, -1 for none. */
  stopCompound: Int8Array;
  /** Per car: its stepping state (`SLOT`, `STRIDE` slots a car). */
  car: Float64Array;
  /** The race order (car slots, the leader first; the running cars only, `Run.m` of them), and the cars' draw keys. */
  order: Int16Array;
  carKeys: Int32Array;
  // per car: where it is
  lap: Int16Array;
  /** Its line times by lap number (`lineIndex`; NaN until it crosses that line). */
  lineT: Float64Array;
  running: Uint8Array;
  // per car: the scenario's draws and its car
  paceMs: Float64Array;
  degMs: Float64Array;
  scatterMs: Float64Array;
  /** The scatter's AR(1) innovation scale, √(1 − ρ²)·σ. */
  innovationMs: Float64Array;
  compound: Uint8Array;
  wearPct: Float64Array;
  fuelKg: Float64Array;
  lapOnSet: Int16Array;
  /** Our cars' sets fitted so far, per car and compound index. */
  setsUsed: Map<number, Int16Array>;
};

/** A lap's draws for a lap outside the field's lap numbers (a car placed on the lap before lap 0): drawn on every use. */
const outsideTable = new Float64Array(D);

/** One reused lap-model input: the forecast calls the lap model once per car and lap. */
const input: LapInput = { paceMs: 0, degMsPerLap: 0, wearPct: 0, fuelKg: 0, compound: 'medium', lapOnSet: 1, neutralised: 'none', wetnessMs: 0, wet: false, scatterMs: 0, mistakeMs: 0 };

/** A field's typed arrays, by size: per car, per car and lap, per lap. */
type Arrays = Pick<Field, 'paceZ' | 'degZ' | 'lapDraws' | 'wetnessMsByLap' | 'wetByLap' | 'neutralByLap' | 'vscLapMs' | 'stopCompound' | 'car' | 'order' | 'carKeys' | 'lap' | 'lineT' | 'running' | 'paceMs' | 'degMs' | 'scatterMs' | 'innovationMs' | 'compound' | 'wearPct' | 'fuelKg' | 'lapOnSet'>;

function allocate(n: number, laps: number): Arrays {
  return {
    paceZ: new Float64Array(n),
    degZ: new Float64Array(n),
    lapDraws: new Float64Array(n * laps * D),
    wetnessMsByLap: new Float64Array(laps),
    wetByLap: new Uint8Array(laps),
    neutralByLap: new Uint8Array(laps),
    vscLapMs: new Float64Array(laps),
    stopCompound: new Int8Array(n * laps),
    car: new Float64Array(n * W),
    order: new Int16Array(n),
    carKeys: new Int32Array(n),
    lap: new Int16Array(n),
    lineT: new Float64Array(n * laps),
    running: new Uint8Array(n),
    paceMs: new Float64Array(n),
    degMs: new Float64Array(n),
    scatterMs: new Float64Array(n),
    innovationMs: new Float64Array(n),
    compound: new Uint8Array(n),
    wearPct: new Float64Array(n),
    fuelKg: new Float64Array(n),
    lapOnSet: new Int16Array(n),
  };
}

/**
 * The last forecast's arrays, reused by the next of the same size (spec 10's budget: each typed array with its own
 * buffer costs about a microsecond to allocate). Every array is reset before use. Safe because one forecast runs at a
 * time (none calls another; a worker thread has its own module) and no forecast keeps its field past its result.
 */
let spare: { n: number; laps: number; arrays: Arrays } | undefined;

function arraysFor(n: number, laps: number): Arrays {
  if (spare === undefined || spare.n !== n || spare.laps !== laps) spare = { n, laps, arrays: allocate(n, laps) };
  const a = spare.arrays;
  a.neutralByLap.fill(0);
  a.vscLapMs.fill(Number.NaN);
  a.car.fill(0);
  a.order.fill(0);
  a.lap.fill(0);
  a.lineT.fill(Number.NaN);
  a.scatterMs.fill(0);
  return a;
}

/** Copies a starting point's per-car array (one entry per car slot) into `to`. */
function copyCars(to: Uint8Array | Float64Array, from: ArrayLike<number>, n: number): void {
  for (let c = 0; c < n; c++) to[c] = from[c] ?? 0;
}

/** Whether `table` holds scenario `scenario`'s draws under base seed `seed` for `n` car slots and `laps` lap numbers. */
const drawsFit = (table: ScenarioDraws, seed: number, scenario: Scenario, n: number, laps: number): boolean =>
  table.base === seed && table.scenario === scenario.id && table.cars === n && table.laps === laps;

/**
 * The field of one forecast; `shared`: the caller's table of the scenario's draws (`ScenarioDraws`), read and filled
 * where it fits this scenario and seed, else the forecast draws into its own.
 */
export function createField(start: StartingPoint, policies: readonly Policy[], scenario: Scenario, seed: number, endLap: number, shared?: ScenarioDraws): Field {
  const n = start.cars;
  const laps = start.lapsTotal + 2;
  const a = arraysFor(n, laps);
  const table = shared !== undefined && drawsFit(shared, seed, scenario, n, laps) ? shared : undefined;
  if (table === undefined) {
    a.paceZ.fill(Number.NaN);
    a.degZ.fill(Number.NaN);
    a.lapDraws.fill(Number.NaN);
  }
  const neutralByLap = a.neutralByLap;
  for (const x of scenario.neutralisations) {
    for (let l = Math.max(0, x.fromLap); l <= Math.min(laps - 1, x.toLap); l++) neutralByLap[l] = Math.max(neutralByLap[l] ?? 0, NEUTRAL[x.kind]);
  }
  fillStopTable(a.stopCompound, start, policies, laps);
  copyCars(a.compound, start.compound, n);
  copyCars(a.wearPct, start.wearPct, n);
  copyCars(a.fuelKg, start.fuelKg, n);
  const draws = drawsInto(seed, scenario.id, a.carKeys);
  const f: Field = {
    start,
    policies,
    plain: scenario.plain,
    draws,
    wetnessByLap: scenario.wetnessByLap,
    endLap,
    ...a,
    ...(table !== undefined && { paceZ: table.pace, degZ: table.deg, lapDraws: table.lap }),
    setsUsed: new Map(Object.keys(start.sets).map((k) => [Number(k), new Int16Array(NOISE_COMPOUNDS.length)])),
  };
  for (let l = 0; l < laps; l++) {
    f.wetnessMsByLap[l] = pathWetnessOn(f, l);
    f.wetByLap[l] = pathWetOn(f, l) ? 1 : 0;
  }
  for (let c = 0; c < n; c++) {
    f.car[c * W + RETIRE_AT] = NO_RETIREMENT;
    f.car[c * W + HELD_BY] = -1;
    f.running[c] = start.retired[c] === 1 ? 0 : 1;
    // pace level and degradation, drawn once per scenario around their σ (spec 6.3)
    f.paceMs[c] = (start.paceMs[c] ?? 0) + (scenario.plain ? 0 : (start.paceSdMs[c] ?? 0) * paceZOf(f, c));
    f.degMs[c] = degOf(f, c, start.compound[c] ?? 0);
    f.lapOnSet[c] = (start.tyreAge[c] ?? 0) + 1;
    const rho = start.rho[c] ?? 0;
    f.innovationMs[c] = Math.sqrt(1 - rho * rho) * (start.sigmaMs[c] ?? 0);
  }
  return f;
}

/**
 * Car `c`'s degradation per % of wear on compound index `k`: the compound's own (`tyreIndex`), drawn once per scenario
 * around its σ (spec 6.3) with the car's one draw, so a stop changes the compound's terms, not the draw.
 */
function degOf(f: Field, c: number, k: number): number {
  const s = f.start;
  const t = tyreAt(c, k);
  const deg = s.tyre.degMsPerLap[t] ?? 0;
  return f.plain ? deg : deg + (s.tyre.degSdMs[t] ?? 0) * degZOf(f, c);
}

/** Car `c`'s pace normal of the scenario (`Field.paceZ`), drawn on first use. */
function paceZOf(f: Field, c: number): number {
  const z = f.paceZ[c] ?? Number.NaN;
  if (!Number.isNaN(z)) return z;
  return (f.paceZ[c] = normalDraw(keyOf(f.draws, c, 0), PACE, 0));
}

/** Car `c`'s degradation normal of the scenario (`Field.degZ`), drawn on first use. */
function degZOf(f: Field, c: number): number {
  const z = f.degZ[c] ?? Number.NaN;
  if (!Number.isNaN(z)) return z;
  return (f.degZ[c] = normalDraw(keyOf(f.draws, c, 0), DEG, 0));
}

/** The track's wetness on lap `lap` (`Scenario.wetnessByLap`; the starting point's where the scenario has none). */
function pathWetnessOn(f: Field, lap: number): number {
  const w = f.wetnessByLap;
  const i = lap - f.start.lap;
  if (w === undefined || w.length === 0 || i < 0) return f.start.wetness.wetnessMs;
  return w[Math.min(i, w.length - 1)] ?? f.start.wetness.wetnessMs;
}

/**
 * Whether the track is wet on lap `lap` by `track-wetness`'s one rule (O3): a scenario's path lap is one world, so the
 * rule with sd 0; the starting point's verdict where the scenario has none.
 */
function pathWetOn(f: Field, lap: number): boolean {
  const w = f.wetnessByLap;
  const i = lap - f.start.lap;
  if (w === undefined || w.length === 0 || i < 0) return f.start.wetness.wet;
  const ms = w[Math.min(i, w.length - 1)];
  return ms === undefined ? f.start.wetness.wet : wetAt(ms, 0, 0);
}

/** The last lap a forecast's per-lap tables hold: a later lap reads it (its path has ended by then, so it is the same). */
const tableLap = (f: Field, lap: number): number => Math.min(lap, f.wetByLap.length - 1);

/** The track's wetness on lap `lap`, from the field's table (`pathWetnessOn`). */
export const wetnessOn = (f: Field, lap: number): number => f.wetnessMsByLap[tableLap(f, lap)] ?? f.start.wetness.wetnessMs;

/** Whether the track is wet on lap `lap`, from the field's table (`pathWetOn`). */
export const wetOn = (f: Field, lap: number): boolean => f.wetByLap[tableLap(f, lap)] === 1;

export const lineIndex = (f: Field, car: number, lap: number): number => car * (f.start.lapsTotal + 2) + lap;

/**
 * Every car's stops by lap (`lineIndex`): the compound index of its policy's first stop at the end of that lap, -1 for
 * none (never at or after the flag). Built once, so a lap's start reads one entry instead of walking the policy.
 */
function fillStopTable(table: Int8Array, start: StartingPoint, policies: readonly Policy[], laps: number): void {
  table.fill(-1);
  for (let c = 0; c < start.cars; c++) {
    for (const stop of policies[c]?.stops ?? []) {
      if (!Number.isInteger(stop.lap) || stop.lap < 0 || stop.lap >= start.lapsTotal) continue;
      const at = c * laps + stop.lap;
      if (table[at] === -1) table[at] = NOISE_COMPOUNDS.indexOf(stop.compound);
    }
  }
}

/** Car `c`'s stop at the end of lap `lap`: its compound index, -1 for none. */
export const stopAt = (f: Field, c: number, lap: number): number => f.stopCompound[lineIndex(f, c, lap)] ?? -1;

/** Car `c` starts lap `lap` (`fromFraction`: where it is on that lap, 0 at its line); `first`: its first lap of the forecast. */
export function startLap(f: Field, c: number, lap: number, fromFraction: number, first: boolean): void {
  const s = f.start;
  const car = f.car;
  const b = c * W;
  const kind = f.neutralByLap[Math.min(lap, f.neutralByLap.length - 1)] ?? NEUTRAL.none;
  f.lap[c] = lap;
  car[b + NEUTRAL_AT] = kind;
  car[b + IN_LAP] = stopAt(f, c, lap) === -1 ? 0 : 1;
  input.paceMs = f.paceMs[c] ?? 0;
  input.degMsPerLap = f.degMs[c] ?? 0;
  input.wearPct = f.wearPct[c] ?? 0;
  input.fuelKg = f.fuelKg[c] ?? 0;
  input.compound = compounds[f.compound[c] ?? 0] ?? 'medium';
  input.lapOnSet = f.lapOnSet[c] ?? 1;
  input.wetnessMs = wetnessOn(f, lap);
  input.wet = wetOn(f, lap);
  input.neutralised = 'none';
  const green = lapTime(s.lapModel, input);
  car[b + GREEN_MS] = green;
  car[b + RETIRE_AT] = NO_RETIREMENT;
  let noiseMs = 0;
  if (!f.plain) {
    // the lap's first draws, shared by the scenario's forecasts (`Field.lapDraws`); a stream's later values on their use
    const inTable = lap >= 0 && lap < f.neutralByLap.length;
    const d = inTable ? f.lapDraws : outsideTable;
    const at = inTable ? lineIndex(f, c, lap) * D : 0;
    if (!inTable || Number.isNaN(d[at] ?? Number.NaN)) drawLapInto(keyOf(f.draws, c, lap), d, at);
    const z = d[at + D_SCATTER] ?? 0;
    // AR(1) with the marginal σ: a stationary first lap, then ρ of the last lap's scatter plus the innovation
    const scatter = first ? (s.sigmaMs[c] ?? 0) * z : (s.rho[c] ?? 0) * (f.scatterMs[c] ?? 0) + (f.innovationMs[c] ?? 0) * z;
    f.scatterMs[c] = scatter;
    if (kind === NEUTRAL.none) {
      noiseMs += scatter;
      if ((d[at + D_MISTAKE] ?? 1) < (s.mistakeRate[c] ?? 0)) {
        noiseMs += (s.mistakeMedianMs[c] ?? 0) * Math.exp((s.mistakeSigmaLog[c] ?? 0) * normalAt(streamAt(keyOf(f.draws, c, lap), MISTAKE), 1));
      }
      // a big slow lap (P5: apart from retirements, and never one)
      if ((d[at + D_BIG_EVENT] ?? 1) < (s.bigEventRate[c] ?? 0)) noiseMs += BIG_MIN_MS + BIG_SPAN_MS * (1 - uniformAt(streamAt(keyOf(f.draws, c, lap), BIG_EVENT), 1));
    }
    if ((d[at + D_RETIRE] ?? 1) < (s.retireRate[c] ?? 0)) {
      const retireAt = uniformAt(streamAt(keyOf(f.draws, c, lap), RETIRE), 1);
      if (retireAt >= fromFraction) car[b + RETIRE_AT] = retireAt;
    }
  }
  if (kind === NEUTRAL.none) car[b + LAP_MS] = green + noiseMs;
  else {
    input.neutralised = NEUTRAL_KIND[kind] ?? 'none';
    if (kind === NEUTRAL.vsc) {
      // under VSC every car runs one lap time: the lap's first car's (the leader's)
      if (Number.isNaN(f.vscLapMs[lap] ?? Number.NaN)) f.vscLapMs[lap] = lapTime(s.lapModel, input);
      car[b + LAP_MS] = f.vscLapMs[lap] ?? 0;
    } else car[b + LAP_MS] = lapTime(s.lapModel, input);
  }
}

/** Car `c` crossed the line ending lap `lap`: wear and fuel of the lap, a stop's new set; returns the stop's set if it stopped. */
export function endLap(f: Field, c: number, lap: number): NoiseCompound | undefined {
  const s = f.start;
  const kind = f.car[c * W + NEUTRAL_AT] ?? NEUTRAL.none;
  // the compound fitted now: after a stop the new compound's rate (SP4.3c Task 12)
  const rate = s.tyre.wearRatePct[tyreAt(c, f.compound[c] ?? 0)] ?? 0;
  // the starting point's burn (`forecast-field`'s, from `shared/fuel-burn.ts`, O15)
  const burn = s.fuelBurnKgPerLap[c] ?? 0;
  if (kind === NEUTRAL.none) {
    // a green lap's factors are 1 (and × 1 is exact)
    f.wearPct[c] = (f.wearPct[c] ?? 0) + rate;
    f.fuelKg[c] = Math.max(0, (f.fuelKg[c] ?? 0) - burn);
  } else {
    const factors = kind === NEUTRAL.sc ? s.lapModel.neutralised.sc : s.lapModel.neutralised.vsc;
    f.wearPct[c] = (f.wearPct[c] ?? 0) + rate * factors.wearFactor;
    f.fuelKg[c] = Math.max(0, (f.fuelKg[c] ?? 0) - burn * factors.fuelFactor);
  }
  f.lapOnSet[c] = (f.lapOnSet[c] ?? 0) + 1;
  const k = f.car[c * W + IN_LAP] === 1 ? stopAt(f, c, lap) : -1;
  return k === -1 ? undefined : fitStop(f, c, k);
}

/** Car `c` fits its stop's set of compound index `k` (a fresh one, or our car's next set of it); returns the compound. */
export function fitStop(f: Field, c: number, k: number): NoiseCompound {
  const s = f.start;
  const compound = compounds[k] ?? 'medium';
  f.compound[c] = k;
  f.lapOnSet[c] = 1;
  f.wearPct[c] = 0;
  // the new compound's degradation, with the scenario's one draw for the car (SP4.3c Task 12: per-compound terms)
  f.degMs[c] = degOf(f, c, k);
  const used = f.setsUsed.get(c);
  if (used !== undefined) {
    // our car fits its next set of that compound, at that set's wear; a fresh set once none is left
    const sets = (s.sets[c as keyof typeof s.sets] ?? []).filter((x) => x.compound === compound);
    const set = sets[used[k] ?? 0];
    if (set !== undefined) f.wearPct[c] = set.wearPct;
    used[k] = (used[k] ?? 0) + 1;
  }
  return compound;
}
