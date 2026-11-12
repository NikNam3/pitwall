// The residuals of `driver-noise` and each model's session estimates (SP4.3a spec 5.2). A lap's residual is its
// corrected time against `degradation`'s stint line `α + ν · tyreAge`, minus `track-wetness`'s common mode of the lap
// and its tyre type (C43: both own their part). Each lap counts for the model (AI or human) of the car-driver span it
// belongs to (C26, through the projection module's `membershipOf`); each model keeps only its own laps.
import { type CarId, type FrameNumber, type Ms, type NoiseCompound, type OpenSpan, type Span, type StintRecord, type TrackWetness } from '@pitwall/domain';
import type { AsOfView, DeepReadonly, MembershipSource, Projection } from '@pitwall/engine/readers';
import { tyreTypeOf } from '../crossover/tyre-type.ts';
import type { DegradationOutput, StintDegradation } from '../degradation/index.ts';
import { freeAirLaps } from '../shared/free-air.ts';
import { lapsByCar } from '../shared/stint-laps.ts';
import { membershipByStretch } from '../shared/stretch-membership.ts';
import { timeLossEvents } from '../shared/time-loss/index.ts';
import { rowOf } from './behaviour.ts';
import type { SessionEstimate } from './shrink.ts';

/** The thresholds the estimates read (`DRIVER_NOISE_CONFIG`, and the time-loss detection's `incidents`/`damage` config). */
export type ResidualConfig = {
  freeAirGapMs: Ms;
  /** The laps after each stop, its out lap aside, left out of the scatter set (F4). */
  rejoinSkipLaps: number;
  mistakeSigmas: number;
  bigEventMs: Ms;
  timeLoss: { timeLossMs: Ms; mergeMs: Ms; jumpPct: number; jumpWindowMs: Ms };
};

export type Model = 'ai' | 'human';

/** One lap of a car as a model reads it. */
type LapSample = {
  lap: number;
  /** The residual (ms) on a pace lap (`degradation`'s `used` or `downWeighted`) with a known line and common mode. */
  residual: number | undefined;
  /** A free-air lap (`freeAirLaps`, C43) outside the rejoin laps of the car's stops (F4): a lap of the scatter set if a pace lap. */
  free: boolean;
  /** The car's last lap before a retirement: its slowness is the retirement's, never a big event or a mistake (P5). */
  retiring: boolean;
  completedAt: Ms;
};

/** One model's session estimates of one car: each value with the samples it rests on, `undefined` without enough. */
export type ModelEstimates = {
  /** The free-air pace laps σ, ρ and the AI mistakes rest on (mistake laps included). */
  laps: number;
  /** Every lap of the model (the retirement rate's base). */
  allLaps: number;
  /** The green pace laps (the big events' and the human mistakes' base). */
  paceLaps: number;
  sigmaMs: SessionEstimate;
  rho: SessionEstimate;
  mistakes: number;
  /** The mistake rate's base: the free-air laps for the AI, the pace laps for a human. */
  mistakeBase: number;
  mistakeMedianMs: SessionEstimate;
  mistakeSigmaLog: SessionEstimate;
  bigEvents: number;
  retirements: number;
  /** The newest lap's `completedAt` (a retiring lap aside), else `undefined`. */
  at: Ms | undefined;
};

/** One car's models, its driver at the view's frame, and its own measured wear rates per compound. */
export type CarModels = {
  driver: Model | 'unknown';
  inSession: boolean;
  models: Record<Model, ModelEstimates>;
  ownWear: Partial<Record<NoiseCompound, { ratePct: number; laps: number; at: Ms }>>;
};

const NOISE_COMPOUNDS: ReadonlySet<string> = new Set<NoiseCompound>(['soft', 'medium', 'hard', 'inter', 'wet']);

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/** 1.4826 · the median absolute deviation from `centre`: the robust σ of a normal sample. */
const madSigma = (values: readonly number[], centre: number): number => 1.4826 * median(values.map((x) => Math.abs(x - centre)));

/** The worst corner's known wear rate of a stint, else `undefined`. */
function worstRate(stint: DeepReadonly<StintDegradation>): { ratePct: number; at: Ms } | undefined {
  let worst: { ratePct: number; at: Ms } | undefined;
  for (const k of Object.values(stint.wearRatePctPerLap)) if (k.known && (worst === undefined || k.value > worst.ratePct)) worst = { ratePct: k.value, at: k.at };
  return worst;
}

/** Per compound the car's own measured wear rate: its stints' worst-corner rates, weighted by their laps. */
export function ownWearOf(stints: readonly DeepReadonly<StintDegradation>[]): CarModels['ownWear'] {
  const sums: Partial<Record<NoiseCompound, { sum: number; laps: number; at: Ms }>> = {};
  for (const stint of stints) {
    if (!NOISE_COMPOUNDS.has(stint.visual)) continue;
    const rate = worstRate(stint);
    if (rate === undefined) continue;
    const laps = Math.max(1, stint.laps.length);
    const slot = (sums[stint.visual as NoiseCompound] ??= { sum: 0, laps: 0, at: 0 });
    slot.sum += rate.ratePct * laps;
    slot.laps += laps;
    slot.at = Math.max(slot.at, rate.at);
  }
  const out: CarModels['ownWear'] = {};
  for (const [c, s] of Object.entries(sums)) out[c as NoiseCompound] = { ratePct: s.sum / s.laps, laps: s.laps, at: s.at };
  return out;
}

/**
 * The lag-1 correlation of the residuals over consecutive laps, corrected for its small-sample bias (ruling R32):
 * `E[r₁] ≈ ρ − (1 + 3ρ) / n` (Marriott and Pope), so `ρ ≈ (n · r₁ + 1) / (n − 3)`, clamped to [−1, 1].
 */
function lagOneRho(byLap: ReadonlyMap<number, number>): SessionEstimate {
  const n = byLap.size;
  if (n < 5) return undefined;
  let mean = 0;
  for (const x of byLap.values()) mean += x;
  mean /= n;
  let variance = 0;
  for (const x of byLap.values()) variance += (x - mean) ** 2;
  variance /= n;
  let products = 0;
  let pairs = 0;
  for (const [lap, x] of byLap) {
    const next = byLap.get(lap + 1);
    if (next === undefined) continue;
    products += (x - mean) * (next - mean);
    pairs++;
  }
  if (pairs < 2 || variance === 0) return undefined;
  const r1 = products / pairs / variance;
  const rho = Math.max(-1, Math.min(1, (n * r1 + 1) / (n - 3)));
  return { value: rho, n: pairs };
}

/** The log-normal of mistake sizes: its median `exp(mean ln s)` (one size enough) and log-sd (two or more). */
function logNormalOf(sizes: readonly number[]): { median: SessionEstimate; sigmaLog: SessionEstimate } {
  const logs = sizes.filter((s) => s > 0).map(Math.log);
  if (logs.length === 0) return { median: undefined, sigmaLog: undefined };
  const mean = logs.reduce((s, x) => s + x, 0) / logs.length;
  const median = { value: Math.exp(mean), n: logs.length };
  if (logs.length < 2) return { median, sigmaLog: undefined };
  const sd = Math.sqrt(logs.reduce((s, x) => s + (x - mean) ** 2, 0) / (logs.length - 1));
  return { median, sigmaLog: { value: sd, n: logs.length } };
}

/** One model's estimates from its laps (`samples`), its laps with a time-loss event (`eventLosses`, a human's) and retirements. */
function estimatesOf(model: Model, samples: readonly LapSample[], eventLosses: ReadonlyMap<number, number[]>, retirements: number, config: ResidualConfig): ModelEstimates {
  const pace = samples.filter((s) => s.residual !== undefined);
  const free = pace.filter((s) => s.free);
  // as of the newest lap the noise rests on: a retiring lap's time is the retirement's (P5)
  const at = samples.reduce<Ms | undefined>((a, s) => (s.retiring ? a : Math.max(a ?? 0, s.completedAt)), undefined);

  // σ over the free-air laps without mistakes: laps beyond `mistakeSigmas` σ on the slow side are trimmed until the set
  // is stable, and a human's laps with a time-loss event never enter it
  const base = free.filter((s) => model === 'ai' || !eventLosses.has(s.lap));
  let clean = base;
  let centre = clean.length > 0 ? median(clean.map((s) => s.residual as number)) : 0;
  let sigma = clean.length > 0 ? madSigma(clean.map((s) => s.residual as number), centre) : 0;
  for (let i = 0; i < 20 && base.length > 0; i++) {
    const next = base.filter((s) => (s.residual as number) - centre <= config.mistakeSigmas * sigma);
    if (next.length === clean.length || next.length === 0) break;
    clean = next;
    const values = clean.map((s) => s.residual as number);
    centre = median(values);
    sigma = madSigma(values, centre);
  }
  const cleanLaps = new Set(clean.map((s) => s.lap));
  const centreAll = pace.length > 0 && clean.length === 0 ? median(pace.map((s) => s.residual as number)) : centre;

  // big events: a pace lap more than `bigEventMs` slow, apart from the mistakes (P5)
  const isBig = (s: LapSample) => !s.retiring && (s.residual as number) - centreAll > config.bigEventMs;
  const bigEvents = pace.filter(isBig).length;

  let mistakes: number;
  let mistakeBase: number;
  let sizes: number[];
  if (model === 'ai') {
    const slow = free.filter((s) => !cleanLaps.has(s.lap) && !isBig(s) && !s.retiring);
    mistakes = slow.length;
    mistakeBase = free.length;
    sizes = slow.map((s) => (s.residual as number) - centre);
  } else {
    const paceLaps = new Set(pace.filter((s) => !isBig(s)).map((s) => s.lap));
    sizes = [...eventLosses].filter(([lap]) => paceLaps.has(lap)).flatMap(([, losses]) => losses);
    mistakes = sizes.length;
    mistakeBase = pace.length;
  }
  const size = logNormalOf(sizes);
  const residualsByLap = new Map(clean.map((s) => [s.lap, s.residual as number]));
  return {
    laps: free.length,
    allLaps: samples.length,
    paceLaps: pace.length,
    sigmaMs: clean.length >= 3 ? { value: sigma, n: clean.length } : undefined,
    rho: lagOneRho(residualsByLap),
    mistakes,
    mistakeBase,
    mistakeMedianMs: size.median,
    mistakeSigmaLog: size.sigmaLog,
    bigEvents,
    retirements,
    at,
  };
}

/** A car's car-driver and car-status spans, closed and open, as a membership source (C26) holding nothing else. */
function carSource(closed: readonly DeepReadonly<Span>[], open: readonly DeepReadonly<OpenSpan>[], view: AsOfView): MembershipSource {
  const spans: Record<string, DeepReadonly<Span>[]> = {};
  const byMachine: Record<string, DeepReadonly<OpenSpan>[]> = {};
  for (const s of closed) (spans[s.machine] ??= []).push(s);
  for (const s of open) (byMachine[s.machine] ??= []).push(s);
  return { history: { spans } as unknown as DeepReadonly<Projection>, situation: { weekendPhase: view.situation.weekendPhase, byMachine } };
}

/** The car-driver kind a fact of the car describing a frame belongs to, if any (membership once per stretch, C26). */
function modelsAt(source: MembershipSource): (carId: CarId, frame: FrameNumber) => Model | undefined {
  const memberOf = membershipByStretch(source);
  return (carId, frame) => {
    const span = memberOf({ frame, carId })['car-driver'];
    return span === undefined ? undefined : rowOf('car-driver', span.kind).model;
  };
}

/** Appends `value` to `map`'s list at `key`. */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) map.set(key, [value]);
  else list.push(value);
}

/** Every car's models as of `view`'s frame. The cars: those car-status has in the session, else (a stored session) those with laps. */
export function carModelsOf(view: AsOfView, config: ResidualConfig): Map<CarId, CarModels> {
  const degradation = (view.outputs.get('degradation') as DegradationOutput | undefined) ?? {};
  const wetness = view.outputs.get('track-wetness') as TrackWetness | undefined;
  const free = freeAirLaps(view.history, config.freeAirGapMs);

  // per car its spans of the two car machines
  const closedBy = new Map<CarId, DeepReadonly<Span>[]>();
  const openBy = new Map<CarId, DeepReadonly<OpenSpan>[]>();
  for (const machine of ['car-driver', 'car-status'] as const) {
    for (const s of view.history.spans[machine] ?? []) if (s.carId !== undefined) pushTo(closedBy, s.carId, s);
    for (const s of view.situation.byMachine[machine] ?? []) if (s.carId !== undefined) pushTo(openBy, s.carId, s);
  }
  const lapsBy = lapsByCar(view.history);
  const rejoinBy = rejoinLapsByCar(view.history.stints, config.rejoinSkipLaps);

  const statusOpen = view.situation.byMachine['car-status'] ?? [];
  const cars = new Set<CarId>();
  if (statusOpen.length > 0) {
    for (const s of statusOpen) if (s.carId !== undefined && rowOf('car-status', s.kind).inSession === true) cars.add(s.carId);
  } else for (const id of lapsBy.keys()) cars.add(id);

  // the human time-loss events, only where a human model has laps (C45: the shared pure function over the projection)
  let events: Map<string, number[]> | undefined;
  const eventsOf = (): Map<string, number[]> => {
    if (events !== undefined) return events;
    events = new Map();
    for (const e of timeLossEvents(view.history, config.timeLoss, () => false)) pushTo(events, `${e.carId}:${e.lap}`, e.lossMs);
    return events;
  };

  const out = new Map<CarId, CarModels>();
  for (const carId of [...cars].sort((a, b) => a - b)) {
    const closed = closedBy.get(carId) ?? [];
    const open = openBy.get(carId) ?? [];
    const modelAt = modelsAt(carSource(closed, open, view));
    const own = degradation[carId] ?? [];
    // per lap number its stint (the last that holds it) and that stint's first entry of the lap
    // (a later stint overwrites an earlier one; within a stint, backwards, its first entry is written last)
    const byLap: (StintLap | undefined)[] = [];
    for (const stint of own) {
      for (let i = stint.laps.length - 1; i >= 0; i--) {
        const lap = stint.laps[i] as StintLap['lap'];
        byLap[lap.lapNumber] = { stint, lap };
      }
    }

    // the retirements (car-status `retired` spans), each for the model driving when it began; the lap that ended in one
    // (the car's newest lap before the span) stays a lap of its model, but its slowness is the retirement's (P5)
    const retiredSpans = [...closed, ...open].filter((s) => s.machine === 'car-status' && rowOf('car-status', s.kind).retirement === true);
    const carLaps = lapsBy.get(carId) ?? [];
    const retiringLaps = new Set<number>();
    const retirements: Record<Model, number> = { ai: 0, human: 0 };
    for (const s of retiredSpans) {
      const m = modelAt(carId, s.startFrame);
      if (m !== undefined) retirements[m]++;
      const before = carLaps.filter((l) => l.frame < s.startFrame).at(-1);
      if (before !== undefined) retiringLaps.add(before.lapNumber);
    }

    const rejoin = rejoinBy.get(carId);
    const samples: Record<Model, LapSample[]> = { ai: [], human: [] };
    for (const l of carLaps) {
      const m = modelAt(carId, l.frame);
      if (m === undefined) continue;
      samples[m].push({
        lap: l.lapNumber,
        residual: residualOf(byLap[l.lapNumber], l.lapNumber, wetness),
        free: free.isFree(carId, l.lapNumber) && rejoin?.has(l.lapNumber) !== true,
        retiring: retiringLaps.has(l.lapNumber),
        completedAt: l.completedAt,
      });
    }
    const losses = new Map<number, number[]>();
    if (samples.human.length > 0) {
      for (const s of samples.human) {
        const own = eventsOf().get(`${carId}:${s.lap}`);
        if (own !== undefined) losses.set(s.lap, own);
      }
    }

    // the driver at the view's frame: the open car-driver span only (C20, C26; a stored session's as-of view holds the
    // spans covering its last frame open), else unknown
    const driverSpan = open.find((s) => s.machine === 'car-driver');
    const driver = driverSpan === undefined ? 'unknown' : (rowOf('car-driver', driverSpan.kind).model ?? 'unknown');

    out.set(carId, {
      driver,
      inSession: true,
      models: {
        ai: estimatesOf('ai', samples.ai, new Map(), retirements.ai, config),
        human: estimatesOf('human', samples.human, losses, retirements.human, config),
      },
      ownWear: ownWearOf(own),
    });
  }
  return out;
}

/**
 * Per car the laps after its stops left out of the scatter set (F4): a closed stint ending at lap L (its in lap) is
 * followed by the out lap L + 1 (never a pace lap) and the rejoin laps L + 2 … L + 1 + `skip`.
 */
function rejoinLapsByCar(stints: readonly DeepReadonly<StintRecord>[], skip: number): Map<CarId, Set<number>> {
  const out = new Map<CarId, Set<number>>();
  if (skip <= 0) return out;
  for (const s of stints) {
    let laps = out.get(s.carId);
    if (laps === undefined) out.set(s.carId, (laps = new Set()));
    for (let i = 1; i <= skip; i++) laps.add(s.lastLap + 1 + i);
  }
  return out;
}

/** A lap's stint and the stint's entry of the lap. */
type StintLap = { stint: DeepReadonly<StintDegradation>; lap: DeepReadonly<StintDegradation>['laps'][number] };

/** A lap's residual: its corrected time against its stint's line, minus the common mode of its lap and tyre type. */
function residualOf(entry: StintLap | undefined, lapNumber: number, wetness: TrackWetness | undefined): number | undefined {
  if (entry === undefined) return undefined;
  const { stint, lap } = entry;
  if (!stint.basePaceMs.known || typeof lap.use === 'object' || !lap.correctedMs.known) return undefined;
  const type = tyreTypeOf(stint.actual);
  const common = type === undefined ? undefined : wetness?.byLap[lapNumber - 1]?.commonModeMs[type];
  if (common === undefined || !common.known) return undefined;
  const nu = stint.nuMsPerLap.known ? stint.nuMsPerLap.value : stint.startPrior.nuMsPerLap;
  return lap.correctedMs.value - (stint.basePaceMs.value + nu * lap.tyreAge) - common.value;
}
