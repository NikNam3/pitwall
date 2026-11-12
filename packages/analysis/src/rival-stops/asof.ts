// `rival-stops` as of a frame (SP4.3a spec 5.3, 6.1): a pure function of the `AsOfView`. Per car in the session: whether
// it owes a stop (its compound-rule span), the window of its next stop (from the tyre age at which this race's peers
// stopped on its compound, else from `tyre-life`'s predicted life, capped by the laps left; an open window to the flag
// when it owes no stop and its set lasts, or when it has no set left) and the odds of its next compound.
import {
  carDriverSpans,
  carStatusSpans,
  addLaps,
  compoundRuleSpans,
  emptyCurrentLaps,
  known,
  unknown,
  type CarId,
  type Known,
  type LapRecord,
  type NoiseCompound,
  type OpenSpan,
  type RivalStop,
  type RivalStops,
  type StintRecord,
  type VisualCompound,
} from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../tyre-life/index.ts';
import { rivalStopsPhaseRow, RIVAL_STOPS_BEHAVIOUR, type RivalStopsEffect } from './behaviour.ts';
import { RIVAL_STOPS_CONFIG } from './config.ts';

type Window = { lowLap: number; midLap: number; highLap: number; toFlag: boolean };
type Odds = Partial<Record<NoiseCompound, number>>;
/** A car's tyre sets as the as-of view's `setsNow` holds them. */
type LiveSets = NonNullable<AsOfView['fixed']['setsNow']>[number];

const DRY = ['soft', 'medium', 'hard'] as const satisfies readonly NoiseCompound[];
const COMPOUNDS: readonly VisualCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const isCompound = (c: VisualCompound): c is NoiseCompound => COMPOUNDS.includes(c);

const NOT_APPLICABLE: Omit<RivalStop, 'basis'> = { owesStop: unknown('notApplicable'), window: unknown('notApplicable'), nextCompound: unknown('notApplicable') };

/** The car-scoped machines the unit reads, each read once (C41) and grouped by car. */
const CAR_MACHINES = [carStatusSpans.machine, compoundRuleSpans.machine, carDriverSpans.machine] as const;

/** Each car's rows (`RIVAL_STOPS_BEHAVIOUR`) of the spans open for it in `view.situation`, merged, by car id. */
function effectsByCar(view: AsOfView): Map<CarId, RivalStopsEffect> {
  const effects = new Map<CarId, RivalStopsEffect>();
  for (const machine of CAR_MACHINES) {
    const byKind = RIVAL_STOPS_BEHAVIOUR[machine] as Record<string, RivalStopsEffect>;
    const open = (view.situation.byMachine[machine] ?? []) as readonly DeepReadonly<OpenSpan>[];
    for (const span of open) {
      if (span.carId === undefined) continue;
      if (!Object.hasOwn(byKind, span.kind)) throw new Error(`behaviour table: no row for ${machine} ${span.kind}`);
      effects.set(span.carId, { ...effects.get(span.carId), ...byKind[span.kind] });
    }
  }
  return effects;
}

/** A car's race so far as the projection holds it: the current record of its newest lap (C25), its closed stints in order. */
type CarHistory = { newest: LapRecord | undefined; stints: StintRecord[] };

/**
 * Per car its newest lap's current record and its closed stints. The current record comes from `addLaps` over only the
 * records of each car's newest lap number: it decides each (car, lap) on its own records, so this is its result over
 * every lap, at a fraction of the work.
 */
function historyByCar(laps: readonly LapRecord[], stints: readonly StintRecord[]): Map<CarId, CarHistory> {
  // one pass: per car the records of its highest lap number so far, in log order
  const newestRecords: LapRecord[][] = [];
  for (const lap of laps) {
    const own = newestRecords[lap.carId];
    if (own === undefined || lap.lapNumber > (own[0] as LapRecord).lapNumber) newestRecords[lap.carId] = [lap];
    else if (lap.lapNumber === (own[0] as LapRecord).lapNumber) own.push(lap);
  }
  const byCar = new Map<CarId, CarHistory>();
  const of = (id: CarId): CarHistory => {
    let h = byCar.get(id);
    if (h === undefined) byCar.set(id, (h = { newest: undefined, stints: [] }));
    return h;
  };
  newestRecords.forEach((own: LapRecord[], id: number) => {
    const n = (own[0] as LapRecord).lapNumber;
    of(id as CarId).newest = addLaps(emptyCurrentLaps(), own)[id]?.[n];
  });
  for (const stint of stints) of(stint.carId).stints.push(stint);
  return byCar;
}

/** The compounds a car has run in the race: those of its closed stints and of the set it runs now. */
function usedCompounds(h: CarHistory | undefined, now: CurrentSet): ReadonlySet<NoiseCompound> {
  const used = new Set<NoiseCompound>([now.compound]);
  for (const s of h?.stints ?? []) if (isCompound(s.visualCompound)) used.add(s.visualCompound);
  return used;
}

/** The set a car runs now: its compound and the laps on it at the end of its newest lap; none before its first lap or on its in lap. */
type CurrentSet = { compound: NoiseCompound; age: number; lastLap: number };

function currentSet(h: CarHistory | undefined): CurrentSet | undefined {
  const lap = h?.newest;
  if (h === undefined || lap === undefined || lap.inLap) return undefined;
  // a closed stint that ends on its newest lap: the car has just stopped, the new set is not in the projection yet
  if (h.stints.some((s) => s.lastLap >= lap.lapNumber)) return undefined;
  if (!isCompound(lap.visualCompound)) return undefined;
  return { compound: lap.visualCompound, age: lap.tyreAgeAtStart + 1, lastLap: lap.lapNumber };
}

/** The laps a stint ran on its set when it ended: its age at fitting plus its laps. */
const stopAge = (s: StintRecord): number => s.tyreAgeAtFitting + s.lastLap - s.firstLap + 1;

const median = (sorted: readonly number[]): number => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

/** The laps the car's set has left by `tyre-life`: its laps to the limit, else a fresh set's life less its age. */
function lifeLeft(life: DeepReadonly<TyreLife> | undefined, set: CurrentSet): number | undefined {
  if (life === undefined) return undefined;
  if (life.lapsToLimit.known) return life.lapsToLimit.value;
  const fresh = life.freshLifeLaps[set.compound];
  return fresh?.known === true ? Math.max(0, fresh.value - set.age) : undefined;
}

/**
 * The car has no set to fit: its sets are known and none but the fitted one is available. An empty list is no count
 * (the game sends every set of a car it shows), so the car keeps its window.
 */
function outOfSets(sets: LiveSets | undefined): boolean {
  if (sets === undefined || !sets.known || sets.value.sets.length === 0) return false;
  return !sets.value.sets.some((s, i) => s.available && i !== sets.value.fittedIdx && !s.fitted);
}

/** The odds of the next compound: the shares of the peers' choices after a stop off `from`, else the dry compounds the car has not used, evenly. */
function oddsOf(choices: readonly NoiseCompound[], used: ReadonlySet<NoiseCompound>, from: NoiseCompound): Odds {
  const odds: Odds = {};
  if (choices.length > 0) {
    for (const c of choices) odds[c] = (odds[c] ?? 0) + 1 / choices.length;
    return odds;
  }
  const unused = DRY.filter((c) => !used.has(c));
  const candidates = unused.length > 0 ? unused : DRY.filter((c) => c !== from);
  for (const c of candidates) odds[c] = 1 / candidates.length;
  return odds;
}

/** Per car in the session, its next stop as of `view`'s frame. */
export function rivalStopsAsOf(view: AsOfView): RivalStops {
  const out: Record<CarId, RivalStop> = {};
  const effects = effectsByCar(view);
  const phase = rivalStopsPhaseRow(view.situation.weekendPhase.kind);
  if (phase.notApplicable === true) {
    for (const [id, effect] of effects) if (effect.inSession === true) out[id] = { ...NOT_APPLICABLE, basis: 'noStop' };
    return out;
  }
  const config = { ...RIVAL_STOPS_CONFIG.defaults, ...view.config[RIVAL_STOPS_CONFIG.key] };
  const spread = config.noPeerSpreadLaps;
  const at = view.at;
  // read once: `asOfNow` builds it on every read
  const fixed = view.fixed;
  const total = fixed.totalLaps;
  const totalLaps = total.known ? total.value : Infinity;
  const tyreLife = (view.outputs.get(TYRE_LIFE) as DeepReadonly<TyreLifeOutput> | undefined) ?? {};
  const laps = view.history.laps as readonly LapRecord[];
  const history = historyByCar(laps, view.history.stints as readonly StintRecord[]);

  // the peers' stops by the compound they stopped off: the age then and the compound they fitted (the car's next stint,
  // else the set it runs now; none while the car is on its in lap)
  const peerStops = new Map<NoiseCompound, { car: CarId; age: number; next: NoiseCompound | undefined }[]>();
  for (const [car, h] of history) {
    const now = currentSet(h);
    h.stints.forEach((s, i) => {
      if (!isCompound(s.visualCompound)) return;
      const following = h.stints[i + 1];
      const next = following === undefined ? now?.compound : isCompound(following.visualCompound) ? following.visualCompound : undefined;
      const list = peerStops.get(s.visualCompound) ?? [];
      list.push({ car, age: stopAge(s), next });
      peerStops.set(s.visualCompound, list);
    });
  }

  for (const [id, effect] of effects) {
    if (effect.inSession !== true) continue;
    if (effect.notCompeting === true) {
      out[id] = { ...NOT_APPLICABLE, basis: 'noStop' };
      continue;
    }
    const owesStop: Known<boolean> = effect.owesStop === undefined ? unknown('notReceived') : known(effect.owesStop, at);
    const h = history.get(id);
    const set = currentSet(h);
    if (set === undefined) {
      out[id] = { owesStop, window: unknown('insufficientData'), nextCompound: unknown('insufficientData'), basis: 'tyreLife' };
      continue;
    }
    const peers = (peerStops.get(set.compound) ?? []).filter((p) => p.car !== id);
    const choices = peers.flatMap((p) => (p.next === undefined ? [] : [p.next]));
    const nextCompound = known(oddsOf(choices, usedCompounds(h, set), set.compound), at);

    const toFlag = (basis: RivalStop['basis']): RivalStop =>
      total.known
        ? { owesStop, window: known({ lowLap: totalLaps, midLap: totalLaps, highLap: totalLaps, toFlag: true }, at), nextCompound, basis }
        : { owesStop, window: unknown('insufficientData'), nextCompound, basis };
    if (outOfSets(fixed.setsNow?.[id])) {
      out[id] = toFlag('noStop');
      continue;
    }
    const left = lifeLeft(tyreLife[id], set);
    if (effect.owesStop === false && left !== undefined && set.lastLap + left >= totalLaps) {
      out[id] = toFlag('noStop');
      continue;
    }

    // the window in laps on the set, then as lap numbers: from the next lap on, capped by the race's last lap
    let ages: { low: number; mid: number; high: number } | undefined;
    let basis: RivalStop['basis'];
    if (peers.length > 0) {
      const sorted = peers.map((p) => p.age).sort((a, b) => a - b);
      ages = { low: sorted[0] as number, mid: median(sorted), high: sorted.at(-1) as number };
      basis = 'peers';
    } else {
      basis = 'tyreLife';
      if (left !== undefined) {
        const mid = set.age + left;
        ages = { low: mid - spread, mid, high: mid + spread };
      }
    }
    if (ages === undefined) {
      out[id] = { owesStop, window: unknown('insufficientData'), nextCompound, basis };
      continue;
    }
    const unclamped = (age: number): number => Math.round(set.lastLap + age - set.age);
    const lapOf = (age: number): number => Math.min(totalLaps, Math.max(set.lastLap + 1, unclamped(age)));
    // overdue (SP4.3b F3): the high lap is no later than the lap the car is on; the window spreads from its next lap on
    const nextLap = set.lastLap + 2;
    const window: Window =
      unclamped(ages.high) < nextLap
        ? {
            lowLap: Math.min(totalLaps, nextLap),
            midLap: Math.min(totalLaps, nextLap + config.overdueMidLaps),
            highLap: Math.min(totalLaps, nextLap + config.overdueSpreadLaps),
            toFlag: false,
          }
        : { lowLap: lapOf(ages.low), midLap: lapOf(ages.mid), highLap: lapOf(ages.high), toFlag: false };
    out[id] = { owesStop, window: known(window, at), nextCompound, basis };
  }
  return out;
}
