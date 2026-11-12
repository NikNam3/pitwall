// The generator's simulation (SP4.3a spec 6.4): continuous time in 100 ms steps. Each car runs every lap at the constant
// speed of that lap's target time (pace, compound, tyre age, fuel, AR(1) scatter, a log-normal mistake, rain, the pit
// loss), set when it crosses the line; a car within `minGapMs` of a slower car ahead is held there and passes it with a
// hazard over time. Draws come only from seeded streams keyed by (seed, car, lap, purpose) (C2). The state lives in
// typed arrays and each part of a step is its own small function, so the hot loop stays optimised.
import type { NoiseCompound } from '../../packages/domain/src/index.ts';
import { MINI_SECTORS } from '../../packages/domain/src/index.ts';
import { createRng, type Rng } from '../../packages/engine/src/readers.ts';
import type { GeneratorCar, GeneratorParams } from './types.ts';

/** The simulation step. */
export const STEP_MS = 100;
/** One frame every 500 ms of the race clock, the first at 0. */
export const FRAME_MS = 500;
/** Lights out: the field starts moving then; the pole car crosses the line of its lap 1 then. */
export const START_MS = 1_000;
/** A lap's time loss per kg of fuel on board at its start. */
export const FUEL_MS_PER_KG = 30;
/** Under the safety car every car laps this many times slower. */
export const SC_LAP_FACTOR = 1.4;
/** The field leaves the grid in free air: each car this much more than `minGapMs` behind the one ahead. */
export const GRID_EXTRA_GAP_MS = 500;
/** Where the pit lane starts (in lap), the box is and the pit lane ends (out lap), by lap fraction: the box lies past the line. */
export const PIT_ENTRY_FRACTION = 0.96;
export const BOX_FRACTION = 0.03;
export const PIT_EXIT_FRACTION = 0.1;
/** The in lap's share of the pit loss without the stationary time; the out lap carries the rest and the stop. */
export const IN_LAP_SHARE = 0.3;
/** A passing car comes out this far ahead of the car it passed. */
const PASS_MARGIN_M = 1;
/** A guard against parameters that never end the race. */
const MAX_STEPS = 10_000_000;

const PURPOSE = { scatter: 1, mistake: 2, pass: 3 } as const;

/** A 32-bit hash of a stream's key (murmur3's finaliser over each part). */
function streamSeed(seed: number, car: number, lap: number, purpose: number): number {
  let h = 0x811c9dc5;
  for (const part of [seed, car, lap, purpose]) {
    h = Math.imul(h ^ (part | 0), 0x9e3779b1);
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h;
}

const stream = (seed: number, car: number, lap: number, purpose: number): Rng => createRng(streamSeed(seed, car, lap, purpose));

/** A standard normal draw (Box-Muller). */
const normal = (rng: Rng): number => Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());

/** A standard exponential draw. */
const exponential = (rng: Rng): number => -Math.log(1 - rng.next());

/** When a car moving evenly from `from` to `to` in the step from `t` passed `x` (the step's end if it did not move). */
const passedAt = (t: number, from: number, to: number, x: number): number => (to === from ? t + STEP_MS : t + (STEP_MS * (x - from)) / (to - from));

/** One stop as it happened: the times are on the race clock, unrounded; absent until it happened. */
export type SimStop = { lap: number; compound: NoiseCompound; entry?: number; boxIn?: number; boxOut?: number; exit?: number };

export type SimCar = {
  /** When it crossed boundary `(lap - 1) * 50 + segment`, unrounded. */
  crossings: number[];
  stops: SimStop[];
};

export type SimResult = {
  cars: SimCar[];
  /** The safety car's deployment and end, when it happened. */
  sc?: { start: number; end?: number };
  /** When the leader started lap 3 (DRS enabled) and the lap two after the safety car's (DRS back on). */
  drsEnabledAt?: number;
  drsBackAt?: number;
  /** The passes: when, who passed whom. */
  overtakes: { at: number; car: number; other: number }[];
  /** The frame the leader's last lap is confirmed on: the one after it completes it. */
  lastFrame: number;
  /** Per frame (index frame - 1) and car, its total distance after the frame (m, lap n covers [(n - 1) L, n L)). */
  distances: Float64Array;
};

/** The set car `car` runs on lap `n`: its compound and the lap it was fitted for (its first lap). */
export function setOf(car: GeneratorCar, n: number): { compound: NoiseCompound; firstLap: number } {
  let compound: NoiseCompound = car.startCompound ?? 'soft';
  let firstLap = 1;
  for (const stop of car.stops) {
    if (stop.lap >= n) break;
    compound = stop.compound;
    firstLap = stop.lap + 1;
  }
  return { compound, firstLap };
}

/** The fuel on board at the start of lap `n`. */
export const fuelAtStart = (p: GeneratorParams, n: number): number => p.fuelStartKg - (n - 1) * p.fuelPerLapKg;

/** The simulation's state: per car one slot of each array. */
type State = {
  p: GeneratorParams;
  seed: number;
  n: number;
  trackM: number;
  boundaryM: number;
  /** The boundary of the line that completes the last lap. */
  lastBoundary: number;
  inLossMs: number;
  outLossMs: number;
  /** Its lap's AR(1) scatter, target time (ms) and speed (m/ms). */
  scatter: Float64Array;
  target: Float64Array;
  speed: Float64Array;
  /** Its total distance. */
  dist: Float64Array;
  /** When it leaves the box. */
  resumeAt: Float64Array;
  inPit: Uint8Array;
  /** The next boundary it crosses, the distance of its next pit event, its next stop. */
  nextBoundary: Int32Array;
  nextPitM: Float64Array;
  stopIdx: Int32Array;
  /** The advantage its cached pass hazard is for, that hazard, its exposure since its last pass, the exposure its next pass needs. */
  hazardAdvantage: Float64Array;
  baseHazard: Float64Array;
  exposure: Float64Array;
  passDue: Float64Array;
  passRng: Rng[];
  /** The cars by distance, from the front. */
  order: Int32Array;
  zoneStart: Float64Array;
  zoneEnd: Float64Array;
  cars: SimCar[];
  overtakes: SimResult['overtakes'];
  /** When the simulation ends: the end of the frame after the leader's finish (Infinity until then). */
  endT: number;
};

/** Car `c`'s target for lap `lap`, its scatter carried from the lap before (AR(1)), and its speed. */
function startLap(s: State, c: number, lap: number): void {
  const { p } = s;
  const car = p.field[c]!;
  const z = normal(stream(s.seed, c, lap, PURPOSE.scatter));
  s.scatter[c] = lap === 1 ? car.sigmaMs * z : car.rho * s.scatter[c]! + car.sigmaMs * Math.sqrt(1 - car.rho * car.rho) * z;
  const m = stream(s.seed, c, lap, PURPOSE.mistake);
  const mistake = m.next() < car.mistakeRate ? car.mistakeMedianMs * Math.exp(car.mistakeSigmaLog * normal(m)) : 0;
  const set = setOf(car, lap);
  const compound = p.compounds[set.compound];
  const inLap = car.stops.some((stop) => stop.lap === lap);
  const outLap = car.stops.some((stop) => stop.lap + 1 === lap);
  const t =
    car.paceMs +
    compound.offsetMs +
    compound.degMsPerLap * (lap - set.firstLap) +
    FUEL_MS_PER_KG * fuelAtStart(p, lap) +
    s.scatter[c]! +
    mistake +
    (p.rain !== undefined && 'fromLap' in p.rain && lap >= p.rain.fromLap ? p.rain.wetnessMs : 0) +
    (inLap ? s.inLossMs : 0) +
    (outLap ? s.outLossMs : 0);
  s.target[c] = t;
  s.speed[c] = s.trackM / (t - (outLap ? p.stationaryMs : 0));
}

/** The distance of car `c`'s next pit event (its stop's pit entry, box or pit exit), Infinity without one. */
function nextPitEvent(s: State, c: number): number {
  const stop = s.cars[c]!.stops[s.stopIdx[c]!];
  if (stop === undefined) return Infinity;
  if (stop.entry === undefined) return (stop.lap - 1 + PIT_ENTRY_FRACTION) * s.trackM;
  if (stop.boxIn === undefined) return (stop.lap + BOX_FRACTION) * s.trackM;
  return (stop.lap + PIT_EXIT_FRACTION) * s.trackM;
}

/** Whether total distance `d` lies in a DRS zone (a zone may wrap past the line). */
function inDrsZone(s: State, d: number): boolean {
  const f = (d - Math.floor(d / s.trackM) * s.trackM) / s.trackM;
  for (let z = 0; z < s.zoneStart.length; z++) {
    const a = s.zoneStart[z]!;
    const b = s.zoneEnd[z]!;
    if (a <= b ? f >= a && f < b : f >= a || f < b) return true;
  }
  return false;
}

/** Sorts `order` by distance, from the front, ties by id (insertion sort: the order changes little per step). */
function sortOrder(s: State): void {
  const { order, dist } = s;
  for (let i = 1; i < s.n; i++) {
    const c = order[i]!;
    const d = dist[c]!;
    let j = i - 1;
    while (j >= 0 && (dist[order[j]!]! < d || (dist[order[j]!]! === d && order[j]! > c))) {
      order[j + 1] = order[j]!;
      j--;
    }
    order[j + 1] = c;
  }
}

/**
 * Whether car `c`, held within `minGapMs` of car `a` with `advantageMs`, passes it in this step: once its exposure (hazard
 * × time held) reaches its Exp(1) draw, a Poisson process of the hazard over time (a chance of 1 - exp(-hazard × step) per step).
 */
function passes(s: State, c: number, advantageMs: number, at: number, drsOn: boolean): boolean {
  if (advantageMs !== s.hazardAdvantage[c]) {
    s.hazardAdvantage[c] = advantageMs;
    s.baseHazard[c] = s.p.pass.hazardPerS(advantageMs);
  }
  let hazard = s.baseHazard[c]!;
  if (hazard <= 0) return false;
  if (drsOn && inDrsZone(s, at)) hazard *= s.p.pass.drsFactor;
  s.exposure[c] = s.exposure[c]! + (hazard * STEP_MS) / 1_000;
  if (s.exposure[c]! < s.passDue[c]!) return false;
  s.exposure[c] = 0;
  s.passDue[c] = exponential(s.passRng[c]!);
  return true;
}

/**
 * The step from `t`, from the front: each car's new distance (free, held behind the car ahead on track, or past it),
 * then its pit events and boundary crossings. Returns the leader's distance.
 */
function step(s: State, t: number, scOn: boolean, drsOn: boolean): number {
  const t1 = t + STEP_MS;
  const { order, dist, speed, resumeAt, inPit, target, nextBoundary, nextPitM, boundaryM } = s;
  const minGapMs = s.p.pass.minGapMs;
  let ahead = -1;
  /** The car ahead's distance before and after the step. */
  let aheadFrom = 0;
  let aheadTo = 0;
  let lead = -Infinity;
  for (let r = 0; r < s.n; r++) {
    const c = order[r]!;
    const from = dist[c]!;
    const v = scOn ? speed[c]! / SC_LAP_FACTOR : speed[c]!;
    const resume = resumeAt[c]!;
    const moving = resume >= t1 ? 0 : resume > t ? t1 - resume : STEP_MS;
    let d = from + v * moving;
    const onTrack = inPit[c] === 0;
    if (onTrack && ahead >= 0 && v > 0) {
      const minGapM = minGapMs * v;
      const allowed = Math.max(aheadTo - minGapM, from + (aheadTo - aheadFrom));
      if (d > allowed) d = allowed;
      const advantage = target[ahead]! - target[c]!;
      if (!scOn && advantage > 0 && aheadTo - d < minGapM + 1e-6 && passes(s, c, advantage, d, drsOn)) {
        d = aheadTo + PASS_MARGIN_M;
        s.overtakes.push({ at: t1, car: c, other: ahead });
      }
    }
    const to = d < nextBoundary[c]! * boundaryM && d < nextPitM[c]! ? d : crossEvents(s, c, t, from, d);
    dist[c] = to;
    if (to > lead) lead = to;
    if (onTrack) {
      ahead = c;
      aheadFrom = from;
      aheadTo = to;
    }
  }
  return lead;
}

/** Car `c`'s pit events and boundary crossings in the step from `t` (it moved from `from` to `moved`); returns where it ends. */
function crossEvents(s: State, c: number, t: number, from: number, moved: number): number {
  let to = moved;
  const car = s.cars[c]!;
  const stop = car.stops[s.stopIdx[c]!];
  if (stop !== undefined && to >= s.nextPitM[c]!) {
    const L = s.trackM;
    const entry = (stop.lap - 1 + PIT_ENTRY_FRACTION) * L;
    const box = (stop.lap + BOX_FRACTION) * L;
    const exit = (stop.lap + PIT_EXIT_FRACTION) * L;
    if (stop.entry === undefined && from < entry && entry <= to) {
      stop.entry = passedAt(t, from, moved, entry);
      s.inPit[c] = 1;
    }
    if (stop.boxIn === undefined && from < box && box <= to) {
      stop.boxIn = passedAt(t, from, moved, box);
      stop.boxOut = stop.boxIn + s.p.stationaryMs;
      s.resumeAt[c] = stop.boxOut;
      to = box;
    }
    if (stop.exit === undefined && from < exit && exit <= to) {
      stop.exit = passedAt(t, from, moved, exit);
      s.inPit[c] = 0;
      s.stopIdx[c] = s.stopIdx[c]! + 1;
    }
    s.nextPitM[c] = nextPitEvent(s, c);
  }
  while (s.nextBoundary[c]! <= s.lastBoundary && s.nextBoundary[c]! * s.boundaryM <= to) {
    const b = s.nextBoundary[c]!;
    car.crossings.push(passedAt(t, from, moved, b * s.boundaryM));
    s.nextBoundary[c] = b + 1;
    if (b % MINI_SECTORS === 0 && b > 0) {
      if (b === s.lastBoundary && s.endT === Infinity) s.endT = (Math.floor(Math.round(car.crossings[b]!) / FRAME_MS) + 2) * FRAME_MS;
      if (b < s.lastBoundary) startLap(s, c, b / MINI_SECTORS + 1);
    }
  }
  return to;
}

export function simulate(p: GeneratorParams, seed: number): SimResult {
  const n = p.cars;
  const L = p.trackM;
  const inLossMs = IN_LAP_SHARE * (p.pitLossMs - p.stationaryMs);
  const passRng = Array.from({ length: n }, (_, c) => stream(seed, c, 0, PURPOSE.pass));
  const s: State = {
    p,
    seed,
    n,
    trackM: L,
    boundaryM: L / MINI_SECTORS,
    lastBoundary: p.laps * MINI_SECTORS,
    inLossMs,
    outLossMs: p.pitLossMs - inLossMs,
    scatter: new Float64Array(n),
    target: new Float64Array(n),
    speed: new Float64Array(n),
    dist: new Float64Array(n),
    resumeAt: new Float64Array(n),
    inPit: new Uint8Array(n),
    nextBoundary: new Int32Array(n),
    nextPitM: new Float64Array(n),
    stopIdx: new Int32Array(n),
    hazardAdvantage: new Float64Array(n).fill(Number.NaN),
    baseHazard: new Float64Array(n),
    exposure: new Float64Array(n),
    passDue: Float64Array.from(passRng, exponential),
    passRng,
    order: Int32Array.from({ length: n }, (_, c) => c),
    zoneStart: Float64Array.from(p.drsZones, (z) => z.start),
    zoneEnd: Float64Array.from(p.drsZones, (z) => z.end),
    cars: p.field.map((car) => ({ crossings: [], stops: car.stops.map((stop) => ({ lap: stop.lap, compound: stop.compound })) })),
    overtakes: [],
    endT: Infinity,
  };
  const gridGapMs = p.pass.minGapMs + GRID_EXTRA_GAP_MS;
  for (let c = 0; c < n; c++) {
    startLap(s, c, 1);
    s.dist[c] = -c * gridGapMs * s.speed[c]! - 1e-6;
    s.nextPitM[c] = nextPitEvent(s, c);
  }

  /** The leader's distances at which the SC is deployed and in, DRS enabled and back on after the SC. */
  const scFrom = p.sc === undefined ? Infinity : (p.sc.fromLap - 0.5) * L;
  const scTo = p.sc === undefined ? Infinity : (p.sc.toLap - 0.5) * L;
  const drsFrom = 2 * L;
  const drsBack = p.sc === undefined ? Infinity : (p.sc.toLap + 1) * L;
  let scStart: number | undefined;
  let scEnd: number | undefined;
  let drsEnabledAt: number | undefined;
  let drsBackAt: number | undefined;
  let leaderDist = Math.max(...s.dist);
  let distances = new Float64Array(n * 1_024);
  let frames = 0;

  for (let t = 0, steps = 0; t < s.endT; t += STEP_MS, steps++) {
    if (steps > MAX_STEPS) throw new Error('generateRace: the race does not end');
    if (t >= START_MS) {
      const scOn = scStart !== undefined && scEnd === undefined;
      const drsOn = drsEnabledAt !== undefined && !(scStart !== undefined && drsBackAt === undefined);
      sortOrder(s);
      const lead = step(s, t, scOn, drsOn);
      if (scStart === undefined && leaderDist < scFrom && scFrom <= lead) scStart = passedAt(t, leaderDist, lead, scFrom);
      if (scStart !== undefined && scEnd === undefined && leaderDist < scTo && scTo <= lead) scEnd = passedAt(t, leaderDist, lead, scTo);
      if (drsEnabledAt === undefined && leaderDist < drsFrom && drsFrom <= lead) drsEnabledAt = passedAt(t, leaderDist, lead, drsFrom);
      if (drsBackAt === undefined && leaderDist < drsBack && drsBack <= lead) drsBackAt = passedAt(t, leaderDist, lead, drsBack);
      leaderDist = lead;
    }
    if ((t + STEP_MS) % FRAME_MS === 0) {
      if ((frames + 1) * n > distances.length) {
        const grown = new Float64Array(distances.length * 2);
        grown.set(distances);
        distances = grown;
      }
      distances.set(s.dist, frames * n);
      frames++;
    }
  }
  return {
    cars: s.cars,
    ...(scStart !== undefined && { sc: { start: scStart, ...(scEnd !== undefined && { end: scEnd }) } }),
    ...(drsEnabledAt !== undefined && { drsEnabledAt }),
    ...(drsBackAt !== undefined && { drsBackAt }),
    overtakes: s.overtakes,
    lastFrame: s.endT / FRAME_MS,
    distances: distances.subarray(0, frames * n),
  };
}
