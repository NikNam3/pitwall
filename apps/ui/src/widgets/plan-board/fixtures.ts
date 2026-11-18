// Builders and cases shared by the plan-board gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-16-sp4.3d/plan-board.html, gen.mjs `SLOTS`, `DP_PICKS`,
// `boardLines`): Spa, 44 laps, L14, KUH P8 on mediums. Slots A● (active), B, C (its first stop L13 passed), G1, G2; the
// DP's best per stop count (no stop, 1, 2, 3). Each row's place distribution is gen.mjs' `placeDist`, its E[pos] computed
// from it as gen.mjs does; ΔPOS (`diffPlan`, positive = good for us, R31), ΔTIME (`deltaPlanMs`), the ranks and
// `bestPerStops` are written as `strategy` fills them (Task 5). The display computes none of it (C65).
import type { Computed, MachineSpans, PlanningRoundState } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { McRow, McSource, NoiseCompound, Policy, SessionRef, Slot, StrategyCar } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);

/** The board's value for one car (the known part of `StrategyCar`). */
export type BoardTable = Extract<StrategyCar, { known: true }>['value'];

export const PLACES = 20;
/** Our place now (gen.mjs `OUR_PLACE`). */
export const OUR_PLACE = 8;
export const NOW_LAP = 14;
/** Our car (KUH). */
export const KUH = carId(0);

const sum = (a: number[]): number => a.reduce((x, y) => x + y, 0);
/** gen.mjs `placeDist`: a skewed bell around mu plus a retirement share at P20. */
function placeDist(mu: number, sdL: number, sdR: number, dnf = 0.015): number[] {
  const w = Array.from({ length: PLACES }, (_, i) => {
    const d = i + 1 - mu;
    const s = d < 0 ? sdL : sdR;
    return Math.exp(-(d * d) / (2 * s * s));
  });
  const t = sum(w);
  return w.map((x, i) => (x / t) * (1 - dnf) + (i === PLACES - 1 ? dnf : 0));
}
const ePosOf = (p: number[]): number => sum(p.map((x, i) => x * (i + 1)));

const COMPOUND = { S: 'soft', M: 'medium', H: 'hard' } as const satisfies Record<string, NoiseCompound>;
type Stop = [number, keyof typeof COMPOUND];

/** One plan of the sample: its stops, gen.mjs' `mu`, `sd`, `se`, and its mean race time against A (`timeMs`). */
export type Sample = { stops: Stop[]; mu: number; sd: [number, number]; se: number; timeMs: number; start?: keyof typeof COMPOUND };
export type SlotSample = Sample & { slot: Slot; infeasible?: NonNullable<McRow['infeasible']> };
/** A DP pick; `same` names the slot it equals (its `bestPerStops` entry is that slot's row; no row of its own). */
export type DpSample = Sample & { same?: Slot };

/** gen.mjs `SLOTS`. */
export const SLOTS: SlotSample[] = [
  { slot: 'A', stops: [[22, 'H']], mu: 7.52, sd: [1.6, 1.9], se: 0.06, timeMs: 0 },
  { slot: 'B', stops: [[18, 'H'], [33, 'S']], mu: 7.21, sd: [1.7, 1.9], se: 0.07, timeMs: -2400 },
  { slot: 'C', stops: [[13, 'H'], [30, 'H']], mu: 8.4, sd: [1.6, 2.1], se: 0.08, timeMs: 4200, infeasible: 'stopLapPassed' },
  { slot: 'G1', stops: [[20, 'H']], mu: 7.47, sd: [1.6, 1.9], se: 0.06, timeMs: -500 },
  { slot: 'G2', stops: [[17, 'S'], [31, 'H']], mu: 7.74, sd: [1.7, 2.0], se: 0.07, timeMs: 1600 },
];
/** gen.mjs `DP_PICKS`: the DP's best plan with no stop, 1, 2 and 3 stops. */
export const DP_PICKS: DpSample[] = [
  { stops: [], mu: 8.94, sd: [1.5, 2.4], se: 0.08, timeMs: 12_200 },
  { stops: [[21, 'H']], mu: 7.44, sd: [1.6, 1.9], se: 0.06, timeMs: -600 },
  { stops: [[20, 'H'], [34, 'S']], mu: 7.3, sd: [1.7, 1.9], se: 0.07, timeMs: -1900 },
  { stops: [[16, 'H'], [27, 'H'], [37, 'S']], mu: 7.95, sd: [1.8, 2.0], se: 0.08, timeMs: 3300 },
];

/** A plan of the sample; with `start` (the planning round's free start compound, SP4.3d spec §7.2) its `startCompound`. */
export const policyOf = (stops: Stop[], start?: keyof typeof COMPOUND): Policy => ({
  ...(start === undefined ? {} : { startCompound: COMPOUND[start] }),
  stops: stops.map(([lap, c]) => ({ lap, compound: COMPOUND[c] })),
});

export type BoardSpec = {
  slots?: SlotSample[];
  dp?: DpSample[];
  /** The active slot; `null`: no active plan. Default `A`. */
  active?: Slot | null;
  /** The MC's SE multiplied (the cold start's fewer runs: gen.mjs `cold`, × 3). */
  seScale?: number;
  scenarios?: number;
  /** The prefill of slots A and B (SP4.3d spec §7.1 step 5); default `{}`. */
  prefill?: BoardTable['prefill'];
  /** The planning round's grid place, race laps and rain chance; default `null` (the race). */
  planning?: BoardTable['planning'];
};

const GAME_SLOTS: readonly Slot[] = ['G1', 'G2'];

/** The board's table as `strategy` publishes it for KUH: every slot and DP pick a row, ranked by E[pos]. */
export function board(spec: BoardSpec = {}): BoardTable {
  const { slots = SLOTS, dp = DP_PICKS, active = 'A', seScale = 1, scenarios = 1_200, prefill = {}, planning = null } = spec;
  type Drawn = Sample & { slot: Slot | null; source: McSource; infeasible: McRow['infeasible']; pmf: number[]; ePos: number; dpStops?: number };
  const draw = (s: Sample, extra: Pick<Drawn, 'slot' | 'source' | 'infeasible'> & { dpStops?: number }): Drawn => {
    const pmf = placeDist(s.mu, s.sd[0], s.sd[1]);
    return { ...s, ...extra, pmf, ePos: ePosOf(pmf) };
  };
  const drawn: Drawn[] = [
    ...slots.map((s) => draw(s, { slot: s.slot, source: GAME_SLOTS.includes(s.slot) ? 'game' : 'plan', infeasible: s.infeasible ?? null })),
    ...dp.filter((d) => d.same === undefined).map((d) => draw(d, { slot: null, source: 'dp', infeasible: null, dpStops: d.stops.length })),
  ].sort((a, b) => a.ePos - b.ePos);
  const lead = drawn[0];
  if (lead === undefined) throw new Error('no row');
  const ref = active === null ? undefined : drawn.find((r) => r.slot === active);
  if (active !== null && ref === undefined) throw new Error(`no slot ${active}`);
  const rows: McRow[] = drawn.map((r, i) => {
    const isActive = r === ref;
    return {
      policy: policyOf(r.stops, r.start),
      source: r.source,
      slot: r.slot,
      positionPmf: r.pmf,
      ePos: r.ePos,
      ePoints: 0,
      meanMs: 4_980_000 + r.timeMs,
      quantiles: { p10: 5, p50: 8, p90: 11 },
      pGain: sum(r.pmf.slice(0, OUR_PLACE - 1)),
      diff: r.ePos - lead.ePos,
      se: r.se * seScale,
      tie: false,
      committed: isActive,
      infeasible: r.infeasible,
      rank: i + 1,
      deltaLeaderMs: r.timeMs - lead.timeMs,
      deltaPlanMs: ref === undefined ? null : r.timeMs - ref.timeMs,
      diffPlan: ref === undefined || isActive ? unknown('notApplicable') : known(ref.ePos - r.ePos, at),
      sePlan: ref === undefined || isActive ? unknown('notApplicable') : known(0.03 * seScale, at),
      rule: null,
    };
  });
  const bestPerStops: BoardTable['bestPerStops'] = {};
  for (const d of dp) {
    const n = d.stops.length as 0 | 1 | 2 | 3;
    const index = d.same === undefined ? drawn.findIndex((r) => r.dpStops === n) : drawn.findIndex((r) => r.slot === d.same);
    if (index < 0) throw new Error(`no row for ${n} stops`);
    bestPerStops[n] = index;
  }
  return { rows, bestPerStops, scenarios, capHit: false, candidates: 14, hazard: known('ok' as const, at), unresolvedTie: false, currentPosition: OUR_PLACE, prefill, planning };
}

/** The job's result as `strategy.car` publishes it (C51). */
export const computed = (value: StrategyCar): Computed<StrategyCar> => ({ computedFor: { lap: NOW_LAP, frameId: 41_000 }, value });
export const plan = (spec: BoardSpec = {}): Computed<StrategyCar> => computed(known(board(spec), at));

/** `situation.sessionPhaseRace` with one open span of `kind`. */
export const phaseSpans = (kind: string): MachineSpans => ({
  open: [{ machine: 'session-phase-race', id: 0, kind, start: at, confirmed: true, detail: undefined, startFrame: 4_100 }],
});

/** The compact sample (gen.mjs `bCompact`): slots A●, B, G1; the editing figures use it too (C free: "save as C"). */
export const THREE_SLOTS = SLOTS.filter((s) => ['A', 'B', 'G1'].includes(s.slot));
/** The DP's 1-stop pick is A's plan (L22 H): its row shows `= A` (README "What is drawn"). */
export const SAME_AS_A: DpSample[] = DP_PICKS.map((d) => (d.stops.length === 1 ? { ...d, stops: [[22, 'H']], same: 'A' } : d));

/** The mockup's tables. */
export const RACE = board();
export const COMPACT = board({ slots: THREE_SLOTS });
export const COLD = board({ slots: SLOTS.slice(0, 2), dp: DP_PICKS.slice(1, 3), seScale: 3, scenarios: 400 });

// ---- The planning round (SP4.3d2 Task 12; mockup plan-board.html "Planning round", gen.mjs `PLAN_SLOTS`, `PLAN_DP`,
// `START`, `planInputs`): Spa after qualifying, KUH on the grid P8, the race's 44 laps entered (suggested 44), rain 10 %,
// N 1200. G1 entered (the game's plan, M start, L19 H); A and B prefilled from the DP (A = the DP's 1-stop L22 H on M,
// B = its 2-stop L12 H · L30 M on S), not yet saved: no slot is active (activate needs a saved slot). Every plan carries
// its start compound (the DP's free start compound, SP4.3d spec §7.2). G2 is empty: its entry is a window-local draft.

/** The round's race laps (the bridge's suggestion, the track's last stored race, or entered by the engineer). */
export const LAPS = 44;
/** The rain chance of the race's forecast from qualifying, %. */
export const RAIN_PCT = 10;
/** gen.mjs `PLAN_SLOTS`' G1 (entered). */
export const PLAN_G1: SlotSample = { slot: 'G1', stops: [[19, 'H']], start: 'M', mu: 7.71, sd: [1.6, 1.9], se: 0.06, timeMs: 700 };
/** gen.mjs `PLAN_DP` with gen.mjs `START`: the DP's best per stop count, each with its start compound. */
export const PLAN_DP: DpSample[] = [
  { stops: [], start: 'H', mu: 9.1, sd: [1.5, 2.4], se: 0.08, timeMs: 13_000 },
  { stops: [[22, 'H']], start: 'M', mu: 7.62, sd: [1.6, 1.9], se: 0.06, timeMs: 0 },
  { stops: [[12, 'H'], [30, 'M']], start: 'S', mu: 7.4, sd: [1.7, 1.9], se: 0.07, timeMs: -1800 },
  { stops: [[11, 'H'], [23, 'H'], [35, 'S']], start: 'S', mu: 8.02, sd: [1.8, 2.0], se: 0.08, timeMs: 3400 },
];
/** The prefill (gen.mjs `PLAN_SLOTS` A and B): the DP's 1- and 2-stop plans with their start compounds. */
export const PREFILL = { A: policyOf([[22, 'H']], 'M'), B: policyOf([[12, 'H'], [30, 'M']], 'S') } as const satisfies BoardTable['prefill'];

/** The planning job's table for KUH as `plans.preview` publishes it (the strategy job's shape, Task 9). */
export const PLANNING = board({
  slots: [PLAN_G1],
  dp: PLAN_DP,
  active: null,
  prefill: PREFILL,
  planning: { gridPlace: known(OUR_PLACE, at), laps: LAPS, rainPct: known(RAIN_PCT, at) },
});
/** The planning job's result (C51): computed for no race lap yet (the grid). */
export const preview = (value: BoardTable = PLANNING): Computed<StrategyCar> => ({ computedFor: { lap: 0, frameId: 0 }, value: known(value, at) });

/** Our car's race number (Mercedes #12, README sample). */
export const KUH_NUMBER = 12;
/** The weekend and team of the sample (Mercedes). */
export const WEEKEND = 'spa-2026';
export const TEAM = 0;

export type RoundSpec = {
  /** The race laps entered; `null` until entered. Default `LAPS`. */
  entered?: number | null;
  /** The planning job runs. Default `false`. */
  running?: boolean;
  /** KUH's prepared slots. Default G1 only. */
  slots?: Partial<Record<Slot, Policy>>;
  active?: Slot | null;
};

/** The qualifying the round replays (SP4.3e spec §4.3). */
export const QUALIFYING: SessionRef = { sessionUid: '7001', weekendId: WEEKEND };

/** `plans.prepared` while the round is open (`PlanningRoundState`): KUH's prepared plans, the race laps (entered or suggested). */
export function round(spec: RoundSpec = {}): PlanningRoundState {
  const { entered = LAPS, running = false, slots = { G1: policyOf(PLAN_G1.stops, PLAN_G1.start) }, active = null } = spec;
  return {
    open: true,
    qualifying: QUALIFYING,
    practice: [],
    race: { laps: entered, sets: 'carried' },
    team: TEAM,
    cars: { [KUH]: { raceNumber: KUH_NUMBER, slots, active } },
    running,
    saved: [],
  };
}
/** `plans.prepared` outside the planning round: no saved plans of the team on the track (ruling R15). */
export const CLOSED: PlanningRoundState = { open: false, saved: [] };

// ---- The race's grid prefill (SP4.3d spec §7.1 step 7, Task 9: the race's strategy job prefills A and B on the grid
// while no plan is prepared): the race's board on the grid, no slot saved, A and B prefilled, `accept` commits them.
export const GRID_PREFILL = board({ slots: [], dp: PLAN_DP, active: null, prefill: PREFILL });

/** The gallery's synthetic cases (data states only: a selection, the slot picker and an edit draft are window-local, component tests). */
export const cases = {
  // The mockup's first figure (the screenshot baseline): five slots, A active, C infeasible, the DP's four picks.
  race: { plan: plan(), phase: phaseSpans('racing') },
  // The compact figure's slots (A●, B, G1); also the editing figures' board.
  threeSlots: { plan: plan({ slots: THREE_SLOTS }), phase: phaseSpans('racing') },
  // A DP pick equal to a slot: `= A` instead of `→ slot`.
  sameAsSlot: { plan: plan({ dp: SAME_AS_A }), phase: phaseSpans('racing') },
  // L03 after a restart: fewer runs, a wider SE.
  coldStart: { plan: plan({ slots: SLOTS.slice(0, 2), dp: DP_PICKS.slice(1, 3), seScale: 3, scenarios: 400 }), phase: phaseSpans('racing') },
  // The job before its first result: no value; the panel frame shows its computing state ("no data yet").
  computing: {},
  // Not a race, no session: the kit's mark with its reason.
  notApplicable: { plan: computed(unknown('notApplicable')) },
  // The race on the grid without prepared plans: A and B prefilled (dim) with `accept` (command `plan.accept`).
  gridPrefill: { plan: plan({ slots: [], dp: PLAN_DP, active: null, prefill: PREFILL }), phase: phaseSpans('grid') },
  // The planning round (mockup "Planning round"): the race inputs line, the START column, A and B prefilled with
  // `accept`, G1 entered, G2's entry; the live job's last result is ignored while the round is open.
  planningRound: { plan: plan(), preview: preview(), prepared: round() },
  // The planning job running, no result yet: the inputs line and the computing mark.
  planningComputing: { prepared: round({ running: true }) },
  // No race laps known yet (no suggestion, none entered; ruling R16): no job runs; the laps field empty.
  planningNoLaps: { prepared: round({ entered: null }) },
  // `source: planning` outside the planning round: the kit's notApplicable mark.
  planningNotApplicable: { plan: plan(), prepared: CLOSED },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** Per case, the panel options it is drawn with (the planning cases as the plan workbook sets them: `source: planning`). */
export const caseOptions = {
  planningRound: { source: 'planning' },
  planningComputing: { source: 'planning' },
  planningNoLaps: { source: 'planning' },
  planningNotApplicable: { source: 'planning' },
} satisfies NonNullable<GalleryEntry<typeof widget>['caseOptions']>;

/** The gallery's fit sizes: the two minimums (compact 37×7, full 82×13) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 37, rows: 7 },
  { mode: 'compact', cols: 50, rows: 9 },
  { mode: 'full', cols: 82, rows: 13 },
  { mode: 'full', cols: 100, rows: 16 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
