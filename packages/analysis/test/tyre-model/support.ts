// Shared builders of the `tyre-model` tests (SP4.3c spec §5.2, plan Task 12) and of its readers' tests: tyre sets as the
// game gives them, laps with given wear gains (and carcass means), builder views of the cars `tyre-model` reads, and a
// plain `TyreModelCar` for a reader's test that hands `tyre-model`'s output in explicitly.
import {
  carId,
  known,
  NOISE_COMPOUNDS,
  unknown,
  type ActualCompound,
  type CarState,
  type Celsius,
  type Corners,
  type Known,
  type LapRecord,
  type Ms,
  type NoiseCompound,
  type OpenSpan,
  type Percent,
  type StintRecord,
  type TyreModelCar,
  type TyreModelCompound,
  type TyreModelOutput,
  type TyreSet,
  type TyreSource,
  type TyreTerm,
  type VisualCompound,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import { openSpan, situatedView, type Situated } from '../situated.ts';

export const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
export type Corner = (typeof CORNERS)[number];

/** The actual compound of each visual one in these tests: medium is C3, so its default loss per % is 57 ms (research 22 §1.6). */
export const ACTUAL: Record<NoiseCompound, ActualCompound> = { soft: 'C4', medium: 'C3', hard: 'C2', inter: 'inter', wet: 'wet' };

/** Every lap takes 90 s: lap `n` completes at `n · LAP_MS` and describes the frame of that number (C26). */
export const LAP_MS = 90_000;

export const everyCorner = <T>(make: () => T): Corners<T> => ({ fl: make(), fr: make(), rl: make(), rr: make() });
const corners = (w: number | Corners<number>): Corners<number> => (typeof w === 'number' ? { fl: w, fr: w, rl: w, rr: w } : w);
const knownCorners = (w: Corners<number>, at: number): Corners<Known<Percent>> => ({ fl: known(w.fl, at), fr: known(w.fr, at), rl: known(w.rl, at), rr: known(w.rr, at) });

/** A tyre set as the game gives it: new (wear 0), available, not fitted, usable for 28 laps, no delta, unless said otherwise. */
export function tyreSet(visualCompound: NoiseCompound, over: Partial<TyreSet> = {}): TyreSet {
  return {
    actualCompound: ACTUAL[visualCompound],
    visualCompound,
    wearPct: 0,
    available: true,
    fitted: false,
    recommendedSession: 0,
    lifeSpanLaps: 28,
    usableLifeLaps: 28,
    lapDeltaMs: 0,
    ...over,
  };
}

/** The live state's `sets` of `sets` (the fitted one is the first with `fitted`), as of `at`. */
export const liveSets = (sets: TyreSet[], at = 0): Known<{ sets: TyreSet[]; fittedIdx: number }> => known({ sets, fittedIdx: Math.max(0, sets.findIndex((s) => s.fitted)) }, at);

/** What a run of laps is on: car, compound, the carcass mean of each lap (unknown when not given), its tyre sets. */
export type RunOver = { car?: number; compound?: NoiseCompound; from?: number; age?: number; carcassMeanC?: number; tyreSets?: Known<TyreSet[]>; over?: Partial<LapRecord> };

/**
 * Consecutive laps from `from` (default 1), each starting at the wear the lap before ended at (the first at `startPct`)
 * and gaining its entry of `gains` (one number for every corner, or per corner); the set's age at the first lap's start
 * `age` (default `from − 1`). Every lap a green racing lap of 90 s on `compound` (default medium C3).
 */
export function gainLaps(gains: readonly (number | Corners<number>)[], o: RunOver & { startPct?: number | Corners<number> } = {}): LapRecord[] {
  const from = o.from ?? 1;
  const compound = o.compound ?? 'medium';
  const age0 = o.age ?? from - 1;
  let wear = corners(o.startPct ?? 0);
  return gains.map((g, i) => {
    const n = from + i;
    const at = n * LAP_MS;
    const gain = corners(g);
    const end = { fl: wear.fl + gain.fl, fr: wear.fr + gain.fr, rl: wear.rl + gain.rl, rr: wear.rr + gain.rr };
    const l = lap({
      carId: carId(o.car ?? 0),
      lapNumber: n,
      completedAt: at,
      frame: at,
      actualCompound: ACTUAL[compound],
      visualCompound: compound,
      tyreAgeAtStart: age0 + i,
      wearAtStartPct: knownCorners(wear, at),
      wearAtEndPct: knownCorners(end, at),
      ...(o.carcassMeanC !== undefined && { carcassMeanC: everyCorner(() => known(o.carcassMeanC as Celsius, at)) }),
      ...(o.tyreSets !== undefined && { tyreSets: o.tyreSets }),
      ...o.over,
    });
    wear = end;
    return l;
  });
}

/** The newest lap's end wear of `laps` (0 % without laps), per corner. */
export const endWear = (laps: readonly LapRecord[]): Corners<number> => {
  const w = laps.at(-1)?.wearAtEndPct;
  const v = (k: Known<Percent> | undefined): number => (k?.known === true ? k.value : 0);
  return { fl: v(w?.fl), fr: v(w?.fr), rl: v(w?.rl), rr: v(w?.rr) };
};

/** One car as `tyre-model` reads it: its driver, its fitted set now (compound, age, wear and carcass per corner), its sets. */
export type ModelCar = {
  id: number;
  driver?: 'ai' | 'human';
  compound?: NoiseCompound;
  /** The fitted set's actual compound (default `ACTUAL[compound]`). */
  actual?: ActualCompound;
  age?: number;
  wearPct?: number | Corners<number>;
  carcassC?: number;
  /** The live state's sets; default: a fitted set of `compound` (wear the worst corner's) and nothing else. */
  sets?: Known<{ sets: TyreSet[]; fittedIdx: number }>;
};

/** The live car of `c` (no realism: every value known). */
export function modelCarState(c: ModelCar) {
  const compound = c.compound ?? 'medium';
  const actual = c.actual ?? ACTUAL[compound];
  const wear = corners(c.wearPct ?? 0);
  const carcass = c.carcassC ?? 95;
  const worst = Math.max(wear.fl, wear.fr, wear.rl, wear.rr);
  return carState({
    id: carId(c.id),
    tyres: {
      actualCompound: actual,
      visualCompound: compound,
      age: c.age ?? 0,
      corners: {
        fl: { wearPct: known(wear.fl, 0), carcassTempC: known(carcass, 0) },
        fr: { wearPct: known(wear.fr, 0), carcassTempC: known(carcass, 0) },
        rl: { wearPct: known(wear.rl, 0), carcassTempC: known(carcass, 0) },
        rr: { wearPct: known(wear.rr, 0), carcassTempC: known(carcass, 0) },
      },
      sets: c.sets ?? liveSets([tyreSet(compound, { fitted: true, wearPct: worst, actualCompound: actual })]),
    },
  });
}

/**
 * The race view of `cars` (each with its car-driver span, AI unless said otherwise, and a competing car-status span),
 * `laps` and `stints` in the projection, our car the player's (car 0 unless `playerCar`), `outputs` and `config` as given.
 */
export function modelView(
  cars: (ModelCar | ReturnType<typeof carState>)[],
  o: {
    laps?: LapRecord[];
    stints?: StintRecord[];
    drivers?: EngineView['drivers'];
    outputs?: EngineView['outputs'];
    config?: EngineView['config'];
    playerCar?: number;
    spans?: OpenSpan[];
    phase?: Situated['phase'];
    sessionTime?: number;
  } = {},
): EngineView {
  const states = cars.map((c) => ('identity' in c ? c : modelCarState(c)));
  const drivers = cars.map((c) => openSpan('car-driver', 'identity' in c ? 'ai' : (c.driver ?? 'ai'), { car: 'identity' in c ? c.id : c.id }));
  return situatedView({
    cars: states,
    history: { laps: o.laps ?? [], stints: o.stints ?? [] },
    spans: [...drivers, ...(o.spans ?? [])],
    ...(o.phase !== undefined && { phase: o.phase }),
    ...(o.drivers !== undefined && { drivers: o.drivers }),
    outputs: o.outputs ?? new Map(),
    config: o.config ?? {},
    playerCar: o.playerCar ?? 0,
    sessionTime: o.sessionTime ?? (Math.max(0, ...(o.laps ?? []).map((l) => l.completedAt)) + 30_000),
  });
}

/** `view.drivers` with slot `slot` linked to person `person` whose profile entries are `entries`, every other slot unlinked (C62c). */
export function linkedDriver(slot: number, person: string, entries: Record<string, number>): EngineView['drivers'] {
  const profile = {
    person,
    displayName: person.toUpperCase(),
    entries: Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { value: known(value, 0), laps: 120, sessions: 3, newestSession: '2026-11-05' }])),
  };
  return Array.from({ length: 22 }, (_, i) => (i === slot ? known(profile, 0) : unknown('notApplicable')));
}

/** The known value of a term; throws (failing the test) when it is unknown. */
export function valueOf(k: Known<number> | TyreTerm<number>): number {
  const v = 'source' in k ? k.value : k;
  if (!v.known) throw new Error(`unknown: ${v.reason}`);
  return v.value;
}

/** Car `car`'s model in `out`; throws when it has none. */
export function carOf(out: TyreModelOutput, car: number): TyreModelCar {
  const c = out[carId(car)];
  if (c === undefined) throw new Error(`no tyre model for car ${car}`);
  return c;
}

/** The profile entry key of a human's wear factor k on `compound` (SP4.3c spec §5.2, replacing `driverNoise.wearRatePct.*`). */
export const wearFactorKey = (compound: NoiseCompound): string => `tyreModel.wearFactor.${compound}`;

// ---------------------------------------------------------------------------------------------------------------------
// A plain `tyre-model` output for the readers' tests (pit-window, rival-stops, tyre-life, forecast-field).

const term = <T>(value: Known<T>, source: TyreSource = 'game'): TyreTerm<T> => ({ value, source });

/** One compound's plain terms: every corner's rate `ratePct`, ν, loss per %, fresh offset, and the fresh set's laps to the limit. */
export function plainCompound(o: { ratePct?: number; lossMsPerPct?: number; freshOffsetMs?: Ms; lapsToLimit?: Known<number> | number; source?: TyreSource } = {}): TyreModelCompound {
  const rate = o.ratePct ?? 2;
  const loss = o.lossMsPerPct ?? 57;
  const laps = o.lapsToLimit ?? 70 / rate;
  return {
    wearRatePct: everyCorner(() => term(known(rate, 0), o.source)),
    nuMsPerLap: term(known(rate * loss, 0), o.source),
    lossMsPerPct: term(known(loss, 0), o.source),
    freshOffsetMs: term(known(o.freshOffsetMs ?? 0, 0), o.source),
    lapsToLimit: typeof laps === 'number' ? known(laps, 0) : laps,
  };
}

/**
 * A plain `TyreModelCar`: per compound its fresh set's laps to the limit (`lives`, a compound not given `insufficientData`)
 * and rate (`rates`, default 2 %/lap), its available fresh sets per compound (`freshSets`: counts, or one `Known` for all,
 * default 0 each), the type deltas unknown, the limit 70 %; the fitted set's laps to the limit (`fittedLapsToLimit`,
 * default `insufficientData`) and game life span (`fittedLifeSpanLaps`, default `notReceived`), the used sets
 * (`usedSets`, default `notApplicable`: a rival's) (supervisor ruling, 95a9a1b4).
 */
export function plainModelCar(o: {
  lives?: Partial<Record<NoiseCompound, number>>;
  rates?: Partial<Record<NoiseCompound, number>>;
  freshSets?: Partial<Record<NoiseCompound, number>> | Known<number>;
  limitPct?: number;
  fittedLapsToLimit?: Known<number> | number;
  fittedLifeSpanLaps?: Known<number> | number;
  usedSets?: TyreModelCar['usedSets'];
} = {}): TyreModelCar {
  const compounds = Object.fromEntries(
    NOISE_COMPOUNDS.map((c) => {
      const life = o.lives?.[c];
      return [c, plainCompound({ ratePct: o.rates?.[c] ?? 2, lapsToLimit: life === undefined ? unknown('insufficientData') : life })];
    }),
  ) as Record<NoiseCompound, TyreModelCompound>;
  const fresh = o.freshSets;
  const freshSets = Object.fromEntries(
    NOISE_COMPOUNDS.map((c) => [c, fresh !== undefined && 'known' in fresh ? fresh : known((fresh as Partial<Record<NoiseCompound, number>> | undefined)?.[c] ?? 0, 0)]),
  ) as Record<NoiseCompound, Known<number>>;
  const asKnown = (v: Known<number> | number | undefined, otherwise: Known<number>): Known<number> => (v === undefined ? otherwise : typeof v === 'number' ? known(v, 0) : v);
  return {
    compounds,
    typeDeltaMs: { slick: unknown('notReceived'), inter: unknown('notReceived'), wet: unknown('notReceived') },
    freshSets,
    limitPct: o.limitPct ?? 70,
    fittedLapsToLimit: asKnown(o.fittedLapsToLimit, unknown('insufficientData')),
    fittedLifeSpanLaps: asKnown(o.fittedLifeSpanLaps, unknown('notReceived')),
    usedSets: o.usedSets ?? unknown('notApplicable'),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The game's tyre sets on a generator race (whose laps and cars carry none: the builders leave the lap's `tyreSets`
// `notReceived` and the live list empty), so `tyre-model` has a usable life to its prior.

/** The usable life per compound the game sets carry here (laps). */
export const GAME_LIFE: Record<NoiseCompound, number> = { soft: 20, medium: 30, hard: 45, inter: 30, wet: 30 };

/** A fresh set's pace offset against a fresh medium here (ms). */
const OFFSET: Record<NoiseCompound, number> = { soft: -600, medium: 0, hard: 500, inter: 3_500, wet: 8_100 };

/** The default loss per % of each compound's actual one (research 22 §1.6), for the fresh sets' deltas here. */
const LOSS: Record<NoiseCompound, number> = { soft: 75, medium: 57, hard: 35, inter: 11, wet: 11 };

/**
 * The sets of a car on `compound` at `wearPct` (the worst corner): the fitted set, then a fresh soft, medium and hard,
 * each `lapDeltaMs` its offset against the fitted set (the fitted set's loss per % × its wear included).
 */
export function gameSetsOn(compound: NoiseCompound, wearPct: number): TyreSet[] {
  const delta = (c: NoiseCompound): Ms => Math.round(OFFSET[c] - OFFSET[compound] - LOSS[compound] * wearPct) as Ms;
  return [
    tyreSet(compound, { fitted: true, wearPct, usableLifeLaps: GAME_LIFE[compound], lifeSpanLaps: GAME_LIFE[compound] + 4 }),
    ...(['soft', 'medium', 'hard'] as const).map((c) => tyreSet(c, { usableLifeLaps: GAME_LIFE[c], lifeSpanLaps: GAME_LIFE[c] + 4, lapDeltaMs: delta(c) })),
  ];
}

const noiseOf = (visual: string): NoiseCompound => ((NOISE_COMPOUNDS as readonly string[]).includes(visual) ? (visual as NoiseCompound) : 'medium');

/** The worst corner of a known corner set (0 where unknown). */
const worstOf = (w: Corners<Known<Percent>>): number => Math.max(...CORNERS.map((c) => (w[c].known ? w[c].value : 0)));

/** A lap with the sets its car had at the lap's end (`gameSetsOn` its compound and end wear), where it has none yet. */
export const lapWithGameSets = (l: LapRecord): LapRecord =>
  l.tyreSets.known || l.tyreSets.reason === 'realism' ? l : { ...l, tyreSets: known(gameSetsOn(noiseOf(l.visualCompound), worstOf(l.wearAtEndPct)), l.completedAt) };

/** A live car with its sets now (`gameSetsOn` its compound and wear), where its list is empty. */
export const carWithGameSets = <C extends { tyres: { visualCompound: string; corners: Corners<{ wearPct: Known<Percent> }>; sets: Known<{ sets: readonly TyreSet[]; fittedIdx: number }> } }>(car: C): C =>
  car.tyres.sets.known && car.tyres.sets.value.sets.length === 0
    ? { ...car, tyres: { ...car.tyres, sets: known({ sets: gameSetsOn(noiseOf(car.tyres.visualCompound), worstOf({ fl: car.tyres.corners.fl.wearPct, fr: car.tyres.corners.fr.wearPct, rl: car.tyres.corners.rl.wearPct, rr: car.tyres.corners.rr.wearPct })), fittedIdx: 0 }, car.tyres.sets.at) } }
    : car;

/** `view` with the game's sets on every lap and every live car that has none (idempotent). */
export function withGameSets(view: EngineView): EngineView {
  const history = { ...view.history, laps: (view.history.laps as readonly LapRecord[]).map(lapWithGameSets) } as EngineView['history'];
  const cars = view.live.cars.map((c) => carWithGameSets(c as CarState)) as EngineView['live']['cars'];
  return { ...view, history, live: { ...view.live, cars } };
}

/** The fresh sets per compound of a list of sets by the rule `tyre-model` applies (available, not fitted, wear 0: SP4.2 "only new tyre sets"). */
export const freshCounts = (sets: readonly { compound: VisualCompound; wearPct?: number; available?: boolean; fitted?: boolean }[]): Partial<Record<NoiseCompound, number>> => {
  const out: Partial<Record<NoiseCompound, number>> = {};
  for (const s of sets) {
    if ((s.available ?? true) && !(s.fitted ?? false) && (s.wearPct ?? 0) === 0 && (NOISE_COMPOUNDS as readonly string[]).includes(s.compound)) {
      const c = s.compound as NoiseCompound;
      out[c] = (out[c] ?? 0) + 1;
    }
  }
  return out;
};
