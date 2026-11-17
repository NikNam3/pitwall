// `strategy`'s job (C51; SP4.3b spec §8.1), run in one part per our car (SP4.3b Q4 D, Task 25), each in a worker: the
// candidates per our car, the part's car planned against the teammate, then `race-monte-carlo` under the scenario-policy
// cap. No state between runs (C31, C32).
//
// - Per car the DP (`strategy-dp`) from the car's lap on (`startLapOf`), its input from the starting point, the hazard,
//   the weather worlds and each world's plain forecast (`shared/strategy-input/`, SP4.3b2 Task 6, SP4.3c Task 19); its
//   result and its solves (`solveAll`: per world, on a free start per start compound too; queried by `bestWith`) give
//   the candidates (`candidates.ts`, SP4.3c Task 20), and its heaviest world's solve (on a free start, of the best
//   plan's start) its SC/VSC reaction table (`reactions`, SP4.3d spec §5.2).
// - The prefill (SP4.3d spec §7.1 steps 5, 7; `prefill.ts`): where the input asks (the planning job always, the race's
//   job on the grid and in the formation lap, by the behaviour table), slots A and B per car; the planning round's
//   facts (`planning`) where the input carries them (the planning job, `planningInputFrom`). A committed policy is followed as far as it can be (spec §8.2): a passed stop boxes this lap, a
//   stop onto a compound without a set left is dropped; its row is marked with the reason.
// - Plan slots (SP4.3d spec §5.3, `carPlanOf`): the active plan first, then every saved slot, each followed as far as
//   it can be and shown as saved with its reason; a DP plan equal to one is that row. Per car `bestPerStops`: per stop
//   count the best row a DP, neighbour or rule candidate gave (before the dedup), never a slot-only row.
// - The parts (spec §7.3 item 4, §8.1 step 3): `splitStrategy` gives one part per our car planned (`planCar`), or the
//   input as it is when none can be planned; `mergeStrategy` takes each car's entry from the part that planned it and
//   every other entry from the first part. `run` without `planCar` runs the parts one after another on one rng.
// - A part's rounds (spec §8.1 step 2): the teammate committed, the part's car is ranked against the commit with the
//   whole cap (`maxScenarioPolicies`). Else round 1 plans the teammate with `floor(cap × round1Share)` (against the
//   car's commit if it has one, else the car modelled like a rival: left out of `start.sets`) and the car is ranked
//   against the teammate's round-1 best with the rest. A car planned alone, or a round 1 of no scenario-policy, gets
//   the whole cap with the other modelled like a rival.
// - The table's fields (SP4.3b2 Task 6, spec §10): per row its rank (tied rows share the leader's, then index + 1), its
//   mean race time against the leader's and the committed row's; per car its race position at the trigger.
// - `candidatesForRun` is the candidate step's one place and `partFinalCall` a part's final call's;
//   `scripts/gen-strategy-reference.ts` builds its input with them.
import { known, PLAN_SLOTS, unknown, type CarId, type Known, type McRow, type Policy, type Slot, type StartingPoint, type StrategyOutput } from '@pitwall/domain';
import type { Rng } from '@pitwall/engine/readers';
import { RAIN_OUTLOOK_CONFIG } from '../rain-outlook/config.ts';
import { raceMonteCarlo, type McCandidate, type McConfig, type McInput, type McResult, type Reactions } from '../race-monte-carlo/index.ts';
import { committedField, dpInputOn, followable, mcSettingsFrom, notPlannedWhy, plannedCars, plannedField, reactionOf, roadWorlds, strategyConfigOf, toMcHazard, worldsOf, type StrategyInput } from '../shared/strategy-input/index.ts';
import { solveAll, solveDp } from '../strategy-dp/index.ts';
import { bestPlanOf, candidatesOf } from './candidates.ts';
import { prefillOf } from './prefill.ts';
import type { StrategyConfig } from './config.ts';

type Infeasible = McRow['infeasible'];

/** The search's settings from the config (spec §7.3, §11.1). */
function mcConfigOf(config: StrategyConfig, points: number[], planning: boolean): McConfig {
  return {
    n0: config.n0,
    zDrop: config.zDrop,
    zTie: config.zTie,
    tieBand: config.tieBand,
    rescoreTop: config.rescoreTop,
    // the planning round's job runs on its own cap (R34: the race's 8,000 misses its 7 s per part on the grid start)
    maxScenarioPolicies: planning ? config.planningMaxScenarioPolicies : config.maxScenarioPolicies,
    points,
  };
}

/**
 * One car's plan as the job holds it: its candidates and, where committed, the policy followed and the commit's reason;
 * per saved slot the policy saved and why it can no longer be followed as saved (`slots`); the policies the DP,
 * neighbour and rule candidates gave before the dedup (`searched`, `JSON.stringify`ed: what `bestPerStops` names).
 */
export type CarPlan = {
  candidates: McCandidate[];
  followed: Policy | null;
  original: Policy | null;
  infeasible: Infeasible;
  slots: Map<Slot, { original: Policy; infeasible: Infeasible }>;
  searched: Set<string>;
};

const keyOf = (policy: Policy): string => JSON.stringify(policy);

/**
 * Car `car`'s candidates (SP4.3d spec §5.3): the active plan first, as far as it can be followed, in the slot
 * `activePlan` gives it (R32, carried by the input; in no slot: source `committed`);
 * then each other saved slot as far as it can be followed (source `game` for G1 and G2, else `plan`); then the search's
 * own candidates `own` minus every policy already a candidate (a DP plan equal to a slot is that slot's row).
 */
function carPlanOf(field: StartingPoint, car: CarId, own: McCandidate[], original: Policy | null, slots: NonNullable<StrategyInput['slots']>[CarId] | undefined): CarPlan {
  const saved = slots?.saved ?? {};
  const sourceOf = (slot: Slot): McCandidate['source'] => (slot.startsWith('G') ? 'game' : 'plan');
  // the active plan's slot is `activePlan`'s (R32, via the input); none without a committed plan
  const active = original === null ? null : (slots?.active ?? null);
  const candidates: McCandidate[] = [];
  const bySlot: CarPlan['slots'] = new Map();
  let followed: Policy | null = null;
  let infeasible: Infeasible = null;
  if (original !== null) {
    const f = followable(field, car, original);
    followed = f.policy;
    infeasible = f.infeasible;
    candidates.push(active === null ? { policy: f.policy, source: 'committed', rule: null } : { policy: f.policy, source: sourceOf(active), rule: null, slot: active });
    if (active !== null) bySlot.set(active, { original, infeasible });
  }
  for (const slot of PLAN_SLOTS) {
    const policy = saved[slot];
    if (policy === undefined || slot === active) continue;
    const f = followable(field, car, policy);
    candidates.push({ policy: f.policy, source: sourceOf(slot), rule: null, slot });
    bySlot.set(slot, { original: policy, infeasible: f.infeasible });
  }
  const taken = new Set(candidates.map((c) => keyOf(c.policy)));
  return {
    candidates: [...candidates, ...own.filter((c) => !taken.has(keyOf(c.policy)))],
    followed,
    original,
    infeasible,
    slots: bySlot,
    searched: new Set(own.map((c) => keyOf(c.policy))),
  };
}

/**
 * The job's candidate step, its one place: the cars planned and, per car, its candidates (a committed policy first, as
 * far as it can be followed). `mc` is the `race-monte-carlo` input with every planned car's candidates, the committed
 * policies, the hazard, the rival rules and the config's search settings at the whole cap; `null` when no car is
 * planned. `out` holds the cars not planned, each with its reason. Draws the plain forecast from `rng`.
 */
export function candidatesForRun(input: StrategyInput, rng: Rng): { mc: McInput | null; perCar: Map<CarId, CarPlan>; out: StrategyOutput } {
  const out: StrategyOutput = {};
  const perCar = new Map<CarId, CarPlan>();
  const { start: s } = input;
  if (!s.known) {
    for (const car of input.ourCars) out[car] = unknown(s.reason);
    return { mc: null, perCar, out };
  }
  const start = s.value;
  const config = strategyConfigOf(input.config);

  const planned = new Set<CarId>();
  for (const car of input.ourCars) {
    const why = notPlannedWhy(input, start, car);
    if (why === null) planned.add(car);
    else out[car] = unknown(why);
  }
  if (planned.size === 0) return { mc: null, perCar, out };
  const field = plannedField(start, planned);
  const hazard = toMcHazard(input.hazard, field);

  // the weather worlds with their plain roads (one draw per world), shared by our cars
  const worlds = roadWorlds(field, rng, worldsOf(input));
  const candidates: Record<CarId, McCandidate[]> = {};
  const committed: Record<CarId, Policy | null> = {};
  const reactions: Reactions = {};
  for (const car of planned) {
    const dpInput = dpInputOn(field, car, hazard, worlds, config.trafficGapMs);
    // per world, and on a free start (the planning round's grid start) per start compound too (SP4.3d spec §7.2)
    const solutions = solveAll(dpInput);
    const dp = solveDp(dpInput, solutions);
    const candidatesConfig = { ...config, rainPct: RAIN_OUTLOOK_CONFIG.read(input).rainPct };
    // the reaction table on the candidates' best plan's start compound, its one owner (R31; C43)
    reactions[car] = reactionOf(dpInput, solutions, bestPlanOf(field, car, dp, candidatesConfig).startCompound ?? null);
    const own = candidatesOf(field, car, dp, solutions, candidatesConfig);
    const plan = carPlanOf(field, car, own, input.committed[car] ?? null, input.slots?.[car]);
    perCar.set(car, plan);
    candidates[car] = plan.candidates;
    committed[car] = plan.followed;
  }
  const { rivalRules, points } = mcSettingsFrom(input.config);
  return { mc: { start: field, candidates, committed, hazard, rivalRules, config: mcConfigOf(config, points, input.planning != null), reactions }, perCar, out };
}

/** The job's parts (C51): one per our car planned, in our cars' order, each `{ ...input, planCar }`; the input as it is when none can be planned. */
export function splitStrategy(input: StrategyInput): StrategyInput[] {
  const s = input.start;
  const cars = s.known ? plannedCars(input, s.value) : [];
  return cars.length === 0 ? [input] : cars.map((planCar) => ({ ...input, planCar }));
}

/** The parts' outputs joined: each car's entry from the part that planned it (its known one), every other from the first part. */
export function mergeStrategy(outs: readonly StrategyOutput[]): StrategyOutput {
  const merged: StrategyOutput = {};
  for (const out of outs) {
    for (const [key, entry] of Object.entries(out)) {
      const car = Number(key) as CarId;
      if (entry.known || merged[car] === undefined) merged[car] = entry;
    }
  }
  return merged;
}

/** A part's final ranking: its car and its `race-monte-carlo` input, the call's cap in `config.maxScenarioPolicies`. */
export type FinalCall = { car: CarId; mc: McInput };

/**
 * A part up to its final call: its candidate step and, with its teammate uncommitted, its round 1 (both drawn from
 * `rng`). `final` is `null` without `planCar` or when the part's car is not planned; `perCar` and `out` as
 * `candidatesForRun` gives them.
 */
export function partFinalCall(input: StrategyInput, rng: Rng): { final: FinalCall | null; perCar: Map<CarId, CarPlan>; out: StrategyOutput } {
  const { mc: all, perCar: cars, out } = candidatesForRun(input, rng);
  const car = input.planCar;
  if (all === null || car === undefined || !cars.has(car)) return { final: null, perCar: cars, out };
  const config = strategyConfigOf(input.config);
  const done = (final: FinalCall) => ({ final, perCar: cars, out });

  /** Car `c` planned under `cap`; `mate` our other car as certain input following `fixed`, else (absent) modelled like a rival. */
  const callOf = (c: CarId, cap: number, mate?: { car: CarId; fixed: Policy }): FinalCall => {
    const own = cars.get(c) as CarPlan;
    const callSets: StartingPoint['sets'] = { [c]: all.start.sets[c] ?? [] };
    const committed: Record<CarId, Policy | null> = { [c]: own.followed };
    if (mate !== undefined) {
      callSets[mate.car] = all.start.sets[mate.car] ?? [];
      committed[mate.car] = mate.fixed;
    }
    return { car: c, mc: { ...all, start: { ...all.start, sets: callSets }, candidates: { [c]: own.candidates }, committed, config: { ...all.config, maxScenarioPolicies: cap } } };
  };

  // the cap (a count, C2) is the part's whole: round 1 its share rounded down, the final call the rest
  const total = config.maxScenarioPolicies;
  const mate = [...cars.keys()].find((c) => c !== car);
  if (mate === undefined) return done(callOf(car, total));
  // the committed teammate as every job models it (C43, `committedField`): its followed commit, as `perCar` holds it
  const mateFollowed = committedField(input, car)[mate] ?? null;
  if (mateFollowed !== null) return done(callOf(car, total, { car: mate, fixed: mateFollowed }));
  const round1Cap = Math.floor(total * config.round1Share);
  if (round1Cap <= 0) return done(callOf(car, total));
  const ownFollowed = (cars.get(car) as CarPlan).followed;
  const round1 = callOf(mate, round1Cap, ownFollowed === null ? undefined : { car, fixed: ownFollowed });
  const best = ((raceMonteCarlo(round1.mc, rng, round1Cap)[mate] as McResult[CarId]).rows[0] as McRow).policy;
  return done(callOf(car, total - round1Cap, { car: mate, fixed: best }));
}

/** The car's place in the starting point's order, retired cars skipped: its position when the view gave none. */
function orderPlaceOf(start: StartingPoint, car: CarId): number {
  let p = 0;
  for (const c of start.order) {
    if (start.retired[c] === 1) continue;
    p++;
    if (c === car) return p;
  }
  return start.cars;
}

/**
 * The table's fields of ranked rows (spec §10): tied rows share their leader's rank (the first row's), every other row
 * its index + 1; each row's mean race time against the first row's and, with a committed row, against it.
 */
function withTableFields(rows: readonly McRow[]): McRow[] {
  const leader = rows[0];
  const plan = rows.find((r) => r.committed);
  return rows.map((row, i) => ({
    ...row,
    rank: i > 0 && row.tie ? 1 : i + 1,
    deltaLeaderMs: leader === undefined ? 0 : row.meanMs - leader.meanMs,
    deltaPlanMs: plan === undefined ? null : row.meanMs - plan.meanMs,
  }));
}

/** One part: its car's ranked policies, the other entries as `candidatesForRun` gives them. */
function runPart(input: StrategyInput, rng: Rng): StrategyOutput {
  const { final, perCar, out } = partFinalCall(input, rng);
  const { start: s } = input;
  if (final === null || !s.known) return out;
  // as of the starting point: the hazard's own time is when its calculator last ran, which its cadence decides
  const hazardState: Known<'ok'> = input.hazard.known ? known('ok', s.at) : input.hazard;
  const own = perCar.get(final.car) as CarPlan;
  const r = raceMonteCarlo(final.mc, rng, final.mc.config.maxScenarioPolicies)[final.car] as McResult[CarId];
  const bestPerStops = bestPerStopsOf(r.rows, own.searched);
  const stamp = (k: Known<number>): Known<number> => (k.known ? known(k.value, s.at) : k);
  const rows = withTableFields(
    r.rows.map((row): McRow => {
      const stamped = { ...row, diffPlan: stamp(row.diffPlan), sePlan: stamp(row.sePlan) };
      // the active plan and a slot show the policy saved (what the user saved), the search played its followable version
      if (row.committed) return { ...stamped, policy: own.original ?? row.policy, source: row.slot === null ? 'committed' : row.source, infeasible: own.infeasible };
      const slot = row.slot === null ? undefined : own.slots.get(row.slot);
      return slot === undefined ? stamped : { ...stamped, policy: slot.original, infeasible: slot.infeasible };
    }),
  );
  const currentPosition = input.positions[final.car] ?? orderPlaceOf(s.value, final.car);
  // A and B prefilled where the input asks (the planning job; the race's job before the start), each where empty or infeasible
  const infeasible = new Set<Slot>([...own.slots].flatMap(([slot, v]) => (v.infeasible === null ? [] : [slot])));
  const prefill = input.prefill === true ? prefillOf(rows, bestPerStops, input.slots?.[final.car]?.saved ?? {}, infeasible) : {};
  const round = input.planning;
  const planning = round === undefined ? null : { gridPlace: round.gridPlace[final.car] ?? unknown('notApplicable'), laps: round.laps, rainPct: round.rainPct };
  out[final.car] = known({ rows, bestPerStops, scenarios: r.scenarios, capHit: r.capHit, candidates: own.candidates.length, hazard: hazardState, unresolvedTie: r.unresolvedTie, currentPosition, prefill, planning }, s.at);
  return out;
}

const STOP_COUNTS = [0, 1, 2, 3] as const;

/**
 * Per stop count 0–3 the index of the first (best) row whose played policy a DP, neighbour or rule candidate gave
 * (`searched`, before the dedup: a DP plan merged into a slot's row names that row; a slot-only row never), SP4.3d spec
 * §5.3.
 */
function bestPerStopsOf(rows: readonly McRow[], searched: ReadonlySet<string>): Partial<Record<(typeof STOP_COUNTS)[number], number>> {
  const out: Partial<Record<(typeof STOP_COUNTS)[number], number>> = {};
  for (const k of STOP_COUNTS) {
    const i = rows.findIndex((row) => row.policy.stops.length === k && searched.has(keyOf(row.policy)));
    if (i !== -1) out[k] = i;
  }
  return out;
}

/** Our cars' ranked policies (runs in a worker): the part's car with `planCar`, else every part one after another on `rng`. */
export function run(input: StrategyInput, rng: Rng): StrategyOutput {
  if (input.planCar !== undefined) return runPart(input, rng);
  return mergeStrategy(splitStrategy(input).map((part) => runPart(part, rng)));
}
