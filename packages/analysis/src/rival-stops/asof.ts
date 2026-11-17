// `rival-stops` as of a frame (SP4.3a spec 5.3, 6.1): a pure function of the `AsOfView`. Per car in the session: whether
// it owes a stop (its compound-rule span and the dry compounds it has used, `owesSecondDryCompound`), the window of its
// next stop (from the tyre age at which this race's peers stopped on its compound, else from `tyre-life`'s and
// `tyre-model`'s predicted life, capped by the laps left; an open window to the flag when it owes no stop and its set
// lasts, or when `tyre-model` counts no fresh set left) and the odds of its next compound.
import {
  carDriverSpans,
  carStatusSpans,
  addLaps,
  compoundRuleSpans,
  emptyCurrentLaps,
  known,
  NOISE_COMPOUNDS,
  unknown,
  type CarId,
  type Known,
  type LapRecord,
  type NoiseCompound,
  type OpenSpan,
  type RivalStop,
  type RivalStops,
  type StintRecord,
  type TyreModelCar,
  type TyreModelOutput,
  type TyreType,
  tyreTypeOf,
  type Ms,
  type VisualCompound,
} from '@pitwall/domain';
import type { AsOfView, DeepReadonly } from '@pitwall/engine/readers';
import { owesSecondDryCompound } from '../shared/compound-rule.ts';
import { median } from '../shared/stats.ts';
import { TYRE_LIFE, type TyreLife, type TyreLifeOutput } from '../tyre-life/index.ts';
import { TYRE_MODEL } from '../tyre-model/id.ts';
import { rivalStopsPhaseRow, RIVAL_STOPS_BEHAVIOUR, type RivalStopsEffect } from './behaviour.ts';
import { RIVAL_STOPS_CONFIG } from './config.ts';

type Window = { lowLap: number; midLap: number; highLap: number; toFlag: boolean };
type Odds = Partial<Record<NoiseCompound, number>>;

const DRY = ['soft', 'medium', 'hard'] as const satisfies readonly NoiseCompound[];
const COMPOUNDS: readonly VisualCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
const isCompound = (c: VisualCompound): c is NoiseCompound => COMPOUNDS.includes(c);

type Switch = Pick<RivalStop, 'switchLap' | 'switchTo'>;

const NOT_APPLICABLE: Omit<RivalStop, 'basis'> = {
  owesStop: unknown('notApplicable'),
  window: unknown('notApplicable'),
  nextCompound: unknown('notApplicable'),
  switchLap: unknown('notApplicable'),
  switchTo: unknown('notApplicable'),
};

const TYRE_TYPES: readonly TyreType[] = ['slick', 'inter', 'wet'];

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

/**
 * The laps the car's set has left: `tyre-life`'s laps to the limit, else a fresh set's laps to the limit
 * (`tyre-model`'s) less its age.
 */
function lifeLeft(life: DeepReadonly<TyreLife> | undefined, model: DeepReadonly<TyreModelCar> | undefined, set: CurrentSet): number | undefined {
  if (life?.lapsToLimit.known === true) return life.lapsToLimit.value;
  const fresh = model?.compounds[set.compound].lapsToLimit;
  return fresh?.known === true ? Math.max(0, fresh.value - set.age) : undefined;
}

/**
 * The car has no set to fit: `tyre-model` counts its fresh sets and finds none of any compound. Sets of unknown count
 * (a rival's under realism, sets not received) are no count, so the car keeps its window.
 */
function outOfSets(model: DeepReadonly<TyreModelCar> | undefined): boolean {
  if (model === undefined) return false;
  return NOISE_COMPOUNDS.every((c) => {
    const n = model.freshSets[c];
    return n.known && n.value === 0;
  });
}

/** Whether `tyre-model` leaves the car a fresh set of `c`: known and none is no; an unknown count may be. */
const mayFit = (model: DeepReadonly<TyreModelCar> | undefined, c: NoiseCompound): boolean => {
  const n = model?.freshSets[c];
  return n === undefined || !n.known || n.value > 0;
};

/**
 * The odds of the next compound: the shares of the peers' choices after a stop off `from`, else the dry compounds the
 * car has not used, evenly; only compounds the car may still fit (`mayFit`: `tyre-model`'s fresh sets), unless none is.
 */
function oddsOf(peerChoices: readonly NoiseCompound[], used: ReadonlySet<NoiseCompound>, from: NoiseCompound, fits: (c: NoiseCompound) => boolean): Odds {
  const odds: Odds = {};
  const fitting = peerChoices.filter(fits);
  const choices = fitting.length > 0 ? fitting : peerChoices;
  if (choices.length > 0) {
    for (const c of choices) odds[c] = (odds[c] ?? 0) + 1 / choices.length;
    return odds;
  }
  const unused = DRY.filter((c) => !used.has(c));
  const others = unused.length > 0 ? unused : DRY.filter((c) => c !== from);
  const left = others.filter(fits);
  const candidates = left.length > 0 ? left : others;
  for (const c of candidates) odds[c] = 1 / candidates.length;
  return odds;
}

/**
 * The car's tyre-type switch (SP4.3c O5, research 22 §1.7): `tyre-model`'s `typeDeltaMs` of a type other than the car's
 * own below 0 means the AI switches at the end of the lap it is on (`set.lastLap + 1`), onto the type whose delta is
 * lowest. No negative delta of another type, or none known, is no switch (the simulator's lap model decides then).
 */
function switchOf(model: DeepReadonly<TyreModelCar> | undefined, set: CurrentSet | undefined, at: Ms): Switch {
  if (set === undefined || model === undefined) return { switchLap: unknown('insufficientData'), switchTo: unknown('insufficientData') };
  const own = tyreTypeOf(set.compound);
  let best: { type: TyreType; deltaMs: number } | undefined;
  let anyKnown = false;
  for (const type of TYRE_TYPES) {
    if (type === own) continue;
    const delta = model.typeDeltaMs[type];
    if (!delta.known) continue;
    anyKnown = true;
    if (delta.value < 0 && (best === undefined || delta.value < best.deltaMs)) best = { type, deltaMs: delta.value };
  }
  if (best === undefined) {
    const reason = anyKnown ? 'notApplicable' : 'insufficientData';
    return { switchLap: unknown(reason), switchTo: unknown(reason) };
  }
  return { switchLap: known(set.lastLap + 1, at), switchTo: known(best.type, at) };
}

/** The lap numbers of a window in laps on a set (`ages`): from the lap after `set.lastLap` on, capped by the race's last lap. */
function lapsOf(set: Pick<CurrentSet, 'lastLap' | 'age'>, ages: { low: number; mid: number; high: number }, totalLaps: number): Omit<Window, 'toFlag'> {
  const lapOf = (age: number): number => Math.min(totalLaps, Math.max(set.lastLap + 1, Math.round(set.lastLap + age - set.age)));
  return { lowLap: lapOf(ages.low), midLap: lapOf(ages.mid), highLap: lapOf(ages.high) };
}

/**
 * The qualifying row (the planning view, C62d): no race stop seen, so the race row's fields are `notApplicable`; per dry
 * start compound the first stop's window on a fresh set of it from lap 1: a fresh set's laps to the limit
 * (`tyre-model`'s, as `lifeLeft` reads it) ± `noPeerSpreadLaps`, capped by the race's laps. A compound without a known
 * fresh life has no window; without the race's laps there is none (C3).
 */
function fromGrid(view: AsOfView, effects: ReadonlyMap<CarId, RivalStopsEffect>): RivalStops {
  const out: Record<CarId, RivalStop> = {};
  const spread = { ...RIVAL_STOPS_CONFIG.defaults, ...view.config[RIVAL_STOPS_CONFIG.key] }.noPeerSpreadLaps;
  const total = view.fixed.totalLaps;
  const tyreModel = (view.outputs.get(TYRE_MODEL) as DeepReadonly<TyreModelOutput> | undefined) ?? {};
  const grid = { lastLap: 0, age: 0 };
  for (const [id, effect] of effects) {
    if (effect.inSession !== true) continue;
    if (!total.known) {
      out[id] = { ...NOT_APPLICABLE, window: unknown('insufficientData'), basis: 'tyreLife' };
      continue;
    }
    const byStartCompound: NonNullable<RivalStop['byStartCompound']> = {};
    for (const c of DRY) {
      const fresh = tyreModel[id]?.compounds[c].lapsToLimit;
      if (fresh?.known !== true) continue;
      byStartCompound[c] = lapsOf(grid, { low: fresh.value - spread, mid: fresh.value, high: fresh.value + spread }, total.value);
    }
    out[id] = { ...NOT_APPLICABLE, basis: 'tyreLife', byStartCompound };
  }
  return out;
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
  if (phase.fromGrid === true) return fromGrid(view, effects);
  const config = { ...RIVAL_STOPS_CONFIG.defaults, ...view.config[RIVAL_STOPS_CONFIG.key] };
  const spread = config.noPeerSpreadLaps;
  const at = view.at;
  // read once: `asOfNow` builds it on every read
  const fixed = view.fixed;
  const total = fixed.totalLaps;
  const totalLaps = total.known ? total.value : Infinity;
  const tyreLife = (view.outputs.get(TYRE_LIFE) as DeepReadonly<TyreLifeOutput> | undefined) ?? {};
  const tyreModel = (view.outputs.get(TYRE_MODEL) as DeepReadonly<TyreModelOutput> | undefined) ?? {};
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
    const h = history.get(id);
    const set = currentSet(h);
    const owes = effect.rule === undefined ? undefined : owesSecondDryCompound(effect.rule, { stints: h?.stints ?? [] }, id, set?.compound);
    const owesStop: Known<boolean> = owes === undefined ? unknown('notReceived') : known(owes, at);
    const model = tyreModel[id];
    const typeSwitch = switchOf(model, set, at);
    if (set === undefined) {
      out[id] = { owesStop, window: unknown('insufficientData'), nextCompound: unknown('insufficientData'), basis: 'tyreLife', ...typeSwitch };
      continue;
    }
    const peers = (peerStops.get(set.compound) ?? []).filter((p) => p.car !== id);
    const choices = peers.flatMap((p) => (p.next === undefined ? [] : [p.next]));
    const nextCompound = known(oddsOf(choices, usedCompounds(h, set), set.compound, (c) => mayFit(model, c)), at);

    const toFlag = (basis: RivalStop['basis']): RivalStop =>
      total.known
        ? { owesStop, window: known({ lowLap: totalLaps, midLap: totalLaps, highLap: totalLaps, toFlag: true }, at), nextCompound, basis, ...typeSwitch }
        : { owesStop, window: unknown('insufficientData'), nextCompound, basis, ...typeSwitch };
    if (outOfSets(model)) {
      out[id] = toFlag('noStop');
      continue;
    }
    const left = lifeLeft(tyreLife[id], model, set);
    if (owes === false && left !== undefined && set.lastLap + left >= totalLaps) {
      out[id] = toFlag('noStop');
      continue;
    }

    // the window in laps on the set, then as lap numbers: from the next lap on, capped by the race's last lap
    let ages: { low: number; mid: number; high: number } | undefined;
    let basis: RivalStop['basis'];
    if (peers.length > 0) {
      const sorted = peers.map((p) => p.age).sort((a, b) => a - b);
      ages = { low: sorted[0] as number, mid: median(sorted) as number, high: sorted.at(-1) as number };
      basis = 'peers';
    } else {
      basis = 'tyreLife';
      if (left !== undefined) {
        const mid = set.age + left;
        ages = { low: mid - spread, mid, high: mid + spread };
      }
    }
    if (ages === undefined) {
      out[id] = { owesStop, window: unknown('insufficientData'), nextCompound, basis, ...typeSwitch };
      continue;
    }
    const unclamped = (age: number): number => Math.round(set.lastLap + age - set.age);
    // overdue (SP4.3b F3, Task 11d): the median lap is no later than the lap the car is on; the window spreads from its
    // next lap on (clamping the median onto the current lap would box the car at the end of every lap)
    const nextLap = set.lastLap + 2;
    const window: Window =
      unclamped(ages.mid) < nextLap
        ? {
            lowLap: Math.min(totalLaps, nextLap),
            midLap: Math.min(totalLaps, nextLap + config.overdueMidLaps),
            highLap: Math.min(totalLaps, nextLap + config.overdueSpreadLaps),
            toFlag: false,
          }
        : { ...lapsOf(set, ages, totalLaps), toFlag: false };
    out[id] = { owesStop, window: known(window, at), nextCompound, basis, ...typeSwitch };
  }
  return out;
}
