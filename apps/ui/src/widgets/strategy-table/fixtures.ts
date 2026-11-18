// Builders and cases shared by the strategy-table gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/strategy-table-b.html, gen.mjs `CANDIDATES`,
// `ranked`, `prepRows`): Spa, 44 laps, L14, KUH P8 on mediums. Each row's place distribution is gen.mjs' `placeDist`, its
// E[pos] and E[points] computed from it as gen.mjs does; the rank, the tie group, ΔTIME and ΔPLAN are written as
// `strategy` fills them (Task 6: tied rows share their leader's rank, then index + 1; `deltaLeaderMs` against rows[0],
// `deltaPlanMs` against the committed row, null without one). The display computes none of it (C65). A policy is a stop
// list (SP4.3d spec §5.1): the TRG column, its trigger lines and the rival's race number (`cars.overview`) are deleted
// with the triggers (SP4.3d1 Task 3).
import type { Computed, PlanningRoundState } from '@pitwall/contracts';
import { carId, IMPORTED, known, toSessionTime, unknown } from '@pitwall/domain';
import type { McRow, McSource, NoiseCompound, Policy, Slot, StrategyCar } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);

/** The strategy table's value for one car (the known part of `StrategyCar`). */
export type PlanTable = Extract<StrategyCar, { known: true }>['value'];

export const PLACES = 20;
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
/** Our place now (gen.mjs `OUR_PLACE`). */
export const OUR_PLACE = 8;
export const NOW_LAP = 14;

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
const ePtsOf = (p: number[]): number => sum(p.map((x, i) => x * (POINTS[i] ?? 0)));
function quantile(p: number[], q: number): number {
  let c = 0;
  for (const [i, x] of p.entries()) {
    c += x;
    if (c >= q) return i + 1;
  }
  return p.length;
}

type Candidate = {
  source: Exclude<McSource, 'committed'>;
  rule?: NonNullable<McRow['rule']>;
  stops: [number, NoiseCompound][];
  mu: number;
  sdL: number;
  sdR: number;
  timeMs: number;
};

/** gen.mjs `CANDIDATES` (the rule row: mirror ahead). */
const CANDIDATES: Candidate[] = [
  { source: 'dp', stops: [[20, 'hard']], mu: 7.42, sdL: 1.6, sdR: 1.9, timeMs: 0 },
  { source: 'neighbour', stops: [[19, 'hard']], mu: 7.44, sdL: 1.6, sdR: 1.9, timeMs: 600 },
  { source: 'neighbour', stops: [[21, 'hard']], mu: 7.45, sdL: 1.6, sdR: 1.9, timeMs: 900 },
  { source: 'rule', rule: 'mirrorAhead', stops: [[18, 'hard']], mu: 7.64, sdL: 1.6, sdR: 1.9, timeMs: 1_700 },
  { source: 'neighbour', stops: [[22, 'hard']], mu: 7.78, sdL: 1.5, sdR: 2.1, timeMs: 1_400 },
  { source: 'dp', stops: [[16, 'hard'], [31, 'medium']], mu: 7.93, sdL: 1.8, sdR: 2.0, timeMs: 3_200 },
  { source: 'dp', stops: [[14, 'hard']], mu: 8.35, sdL: 1.7, sdR: 2.0, timeMs: 2_600 },
  { source: 'dp', stops: [[26, 'hard']], mu: 8.81, sdL: 1.6, sdR: 2.3, timeMs: 4_100 },
];

/** gen.mjs `TIE`: the tie test's band for the sample. */
const TIE = 0.08;
const SE = 0.03;

type Drawn = Candidate & { pmf: number[]; ePos: number; ePoints: number };
const draw = (c: Candidate): Drawn => {
  const pmf = placeDist(c.mu, c.sdL, c.sdR);
  return { ...c, pmf, ePos: ePosOf(pmf), ePoints: ePtsOf(pmf) };
};

export type TableSpec = {
  /** The committed row by its stops text (`L19 H`). */
  committed?: string;
  /** gen.mjs `openTie`: rows 2 and 3 moved, the first two tied, unresolved at the cap. */
  openTie?: boolean;
  /** Every row tied with the leader (one bracket over all). */
  allTied?: boolean;
  /** Rows shown (default 8). */
  n?: number;
  /** The committed row can no longer be followed as committed. */
  infeasible?: McRow['infeasible'];
  scenarios?: number;
  /** SP4.3d1 Task 11: rows saved in a plan slot, by their stops text (`L19 H` → `B`): source `plan` (`game` for G1, G2). */
  slots?: Partial<Record<string, Slot>>;
  /** SP4.3d2 Task 12: the planning round's ranking: every plan with this start compound (the DP's free start compound). */
  start?: NoiseCompound;
  /** SP4.3d2 Task 12: the planning round's grid place, race laps and rain chance; default `null` (the race). */
  planning?: PlanTable['planning'];
};

const stopsKey = (stops: [number, NoiseCompound][]): string => stops.map(([l, c]) => `L${l} ${c.charAt(0).toUpperCase()}`).join(' ');

const first = <T>(a: T[]): T => {
  const [x] = a;
  if (x === undefined) throw new Error('no row');
  return x;
};

/** A ranked strategy table as `strategy` publishes it for KUH. */
export function table(spec: TableSpec = {}): PlanTable {
  const { committed, openTie = false, allTied = false, n = 8, infeasible = null, slots = {}, start, planning = null } = spec;
  const drawn = (openTie ? CANDIDATES.map((c, i) => (i === 1 ? { ...c, mu: 7.43 } : i === 2 ? { ...c, mu: 7.56 } : c)) : CANDIDATES).map(draw);
  const sorted = [...drawn].sort((a, b) => a.ePos - b.ePos);
  const lead = first(sorted).ePos;
  const inGroup = (r: Drawn, i: number): boolean => (allTied ? true : openTie ? i < 2 : r.ePos - lead < TIE);
  const tied = sorted.filter(inGroup).sort((a, b) => b.ePoints - a.ePoints);
  const rest = sorted.filter((r, i) => !inGroup(r, i));
  const ordered = [...tied, ...rest].slice(0, n);
  const groupSize = Math.min(tied.length, ordered.length);
  const committedAt = committed === undefined ? -1 : ordered.findIndex((r) => stopsKey(r.stops) === committed);
  if (committed !== undefined && committedAt < 0) throw new Error(`no row ${committed}`);
  const leader = first(ordered);
  const planMs = committedAt < 0 ? null : (ordered[committedAt]?.timeMs ?? null);
  const slotOf = (r: Drawn): Slot | null => slots[stopsKey(r.stops)] ?? null;
  const rows: McRow[] = ordered.map((r, i) => {
    const isCommitted = i === committedAt;
    const policy: Policy = { ...(start === undefined ? {} : { startCompound: start }), stops: r.stops.map(([lap, compound]) => ({ lap, compound })) };
    const tie = groupSize > 1 && i < groupSize;
    return {
      policy,
      source: slotOf(r) !== null ? (slotOf(r) === 'G1' || slotOf(r) === 'G2' ? 'game' : 'plan') : isCommitted ? 'committed' : r.source,
      slot: slotOf(r),
      positionPmf: r.pmf,
      ePos: r.ePos,
      ePoints: r.ePoints,
      meanMs: 4_980_000 + r.timeMs,
      quantiles: { p10: quantile(r.pmf, 0.1), p50: quantile(r.pmf, 0.5), p90: quantile(r.pmf, 0.9) },
      pGain: sum(r.pmf.slice(0, OUR_PLACE - 1)),
      diff: r.ePos - leader.ePos,
      se: SE,
      tie,
      committed: isCommitted,
      infeasible: isCommitted ? infeasible : null,
      rank: tie ? 1 : i + 1,
      deltaLeaderMs: r.timeMs - leader.timeMs,
      deltaPlanMs: planMs === null ? null : r.timeMs - planMs,
      // SP4.3d1 Task 5: no slot here; ΔPOS against the active plan not drawn by this table
      diffPlan: unknown('notApplicable'),
      sePlan: unknown('notApplicable'),
      rule: !isCommitted && r.source === 'rule' ? (r.rule ?? null) : null,
    };
  });
  const scenarios = spec.scenarios ?? (openTie ? 5_000 : 2_840);
  return {
    rows,
    bestPerStops: {},
    scenarios,
    capHit: scenarios >= 5_000,
    candidates: 14,
    hazard: known('ok' as const, at),
    unresolvedTie: openTie,
    currentPosition: OUR_PLACE,
    prefill: {},
    planning,
  };
}

/** The job's result as `strategy.car` publishes it (C51). */
export const computed = (value: StrategyCar): Computed<StrategyCar> => ({ computedFor: { lap: NOW_LAP, frameId: 41_000 }, value });
export const plan = (spec: TableSpec = {}): Computed<StrategyCar> => computed(known(table(spec), at));

/** Our car and the link the panel resolves (a non-default feed: the action must carry the link's own feed, R24). */
export const KUH = carId(0);

/** The mockup's tables. */
export const NO_HIGHLIGHT = table(); // rows: L20 H, L19 H, L21 H (tied, rank 1), L18 H (rule), L22 H, …
export const COMMITTED = table({ committed: 'L19 H' });
export const OPEN_TIE = table({ openTie: true });
/** SP4.3d1 Task 11: L19 H saved in slot B, L22 H in G1; nothing active. */
export const SAVED = table({ slots: { 'L19 H': 'B', 'L22 H': 'G1' } });

// ---- SP4.3d2 Task 12: the planning round (plan-workbook.html "Planning round": the table below each board shows the
// planning job's ranking, `plans.preview`, header `SPA · race`). The planning job's ranking: five plans on mediums,
// grid P8, the race's 44 laps, rain 10 %; distinct from the race's eight rows so a test sees which source is drawn.
export const PLANNING = table({
  n: 5,
  start: 'medium',
  scenarios: 1_200,
  planning: { gridPlace: known(OUR_PLACE, at), laps: 44, rainPct: known(10, at) },
});
/** The planning job's result (C51), computed before any race lap. */
export const preview = (value: PlanTable = PLANNING): Computed<StrategyCar> => ({ computedFor: { lap: 0, frameId: 0 }, value: known(value, at) });
/** `plans.prepared` while the round is open (KUH, Mercedes #12; nothing prepared yet, the laps entered). */
export const ROUND: PlanningRoundState = {
  open: true,
  qualifying: { sessionUid: '7001', weekendId: 'spa-2026' },
  practice: [],
  race: { laps: 44, sets: 'carried', conditions: IMPORTED },
  team: 0,
  trackId: 0,
  playerCar: KUH,
  teammateCar: null,
  forecast: { source: { ref: { sessionUid: '7001', weekendId: 'spa-2026' }, startedAt: '2026-01-01T00:00:00Z' }, rows: unknown('notReceived') },
  rebuilding: false,
  cars: { [KUH]: { raceNumber: 12, slots: {}, active: null } },
  running: false,
  saved: [],
};
/** `plans.prepared` outside the planning round: no saved plans of the team on the track (ruling R15). */
export const CLOSED: PlanningRoundState = { open: false, saved: [] };

/** The gallery's synthetic cases (data states only: a highlight is window-local, a component test, P17). */
export const cases = {
  // The mockup's first figure (the screenshot baseline): no highlight, the three tied stop laps under one bracket.
  noHighlight: { plan: plan() },
  // L19 H committed: its line white, its list row `plan` with the bar; ΔPLAN in the info rows.
  committed: { plan: plan({ committed: 'L19 H' }) },
  // A near-tie unresolved at the cap: the bracket and N amber.
  openTie: { plan: plan({ openTie: true }) },
  // Outside the race phase (or our car in the pit lane): the kit's mark with its reason.
  notApplicable: { plan: computed(unknown('notApplicable')) },
  // The job before its first result: no value; the panel frame shows its computing state ("no data yet").
  computing: {},
  // Review Focus 6: one row; every row tied; the committed plan no longer feasible (its stop lap passed).
  oneRow: { plan: plan({ n: 1 }) },
  allTied: { plan: plan({ allTied: true }) },
  infeasible: { plan: plan({ committed: 'L14 H', infeasible: 'stopLapPassed' }) },
  // SP4.3d2 Task 12: the planning round (plan-workbook.html): the planning job's ranking; the race's last result ignored.
  planning: { plan: plan(), preview: preview(), prepared: ROUND },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** Per case, the panel options it is drawn with (the planning case as the plan workbook sets it). */
export const caseOptions = { planning: { source: 'planning' } } satisfies NonNullable<GalleryEntry<typeof widget>['caseOptions']>;

/** The gallery's fit sizes: the two minimums (compact 46×6, full 88×13) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 46, rows: 6 },
  { mode: 'compact', cols: 60, rows: 8 },
  { mode: 'full', cols: 88, rows: 13 },
  { mode: 'full', cols: 110, rows: 18 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
