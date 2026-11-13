// Builders and cases shared by the strategy-table gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/strategy-table-b.html, gen.mjs `CANDIDATES`,
// `ranked`, `prepRows`): Spa, 44 laps, L14, KUH P8 on mediums. Each row's place distribution is gen.mjs' `placeDist`, its
// E[pos] and E[points] computed from it as gen.mjs does; the rank, the tie group, ΔTIME and ΔPLAN are written as
// `strategy` fills them (Task 6: tied rows share their leader's rank, then index + 1; `deltaLeaderMs` against rows[0],
// `deltaPlanMs` against the committed row, null without one). The display computes none of it (C65).
import type { CarOverview, Computed } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { CarId, McRow, McSource, NoiseCompound, Policy, StrategyCar, Trigger } from '@pitwall/domain';
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

/** The triggers of a stop plan: an SC and a VSC trigger over one range (joined as `SC/VSC L12–24`), damage, degradation. */
export function triggersOf(from: number, to: number): Trigger[] {
  return [
    { kind: 'neutralised', condition: 'sc', fromLap: from, toLap: to, action: { box: 'hard' } },
    { kind: 'neutralised', condition: 'vsc', fromLap: from, toLap: to, action: { box: 'hard' } },
    { kind: 'damage', lossMsPerLap: 1_200, action: { box: 'hard' } },
    { kind: 'degradationOff', wearRateDeltaPct: 30, action: { switchTo: [{ lap: 18, compound: 'hard' }] } },
  ];
}

/** A `cars.overview` entry with only the identity that matters here (the slot is not the race number). */
export function overview(slot: number, name: string, raceNumber: number): CarOverview {
  return {
    id: carId(slot),
    identity: {
      name, teamId: 0, raceNumber, nationality: 0, driverId: slot, networkId: 255, myTeam: slot === 0,
      platform: 0, telemetryPublic: true, visibility: 'public',
    },
    timing: {} as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: 13 },
    updatedAt: {},
  };
}

/** The rival a `cover` rule watches: slot 3, race number 44 (a slot-printing implementation shows `#3`). */
export const RIVAL = carId(3);
export const RIVAL_NUMBER = 44;
/** A slot `cars.overview` does not list (no participant data yet): its race number unknown. */
export const UNLISTED = carId(9);
/** The field of `cars.overview`: race numbers unlike the slots. */
export const FIELD: CarOverview[] = [
  overview(0, 'Nikolas Kuhnlein', 7), overview(1, 'Mia Lindqvist', 21), overview(2, 'Charles Leclerc', 16),
  overview(3, 'Lewis Hamilton', RIVAL_NUMBER), overview(4, 'Lando Norris', 4), overview(5, 'Max Verstappen', 1),
];

/** The cover trigger of the `rival` spec: box when the car (default #44, slot 3) pits within 1.0 s. */
export const coverTrigger = (car: CarId = RIVAL): Trigger => ({ kind: 'rivalPits', carId: car, withinMs: 1_000, action: 'cover' });

type Candidate = {
  source: Exclude<McSource, 'committed'>;
  rule?: NonNullable<McRow['rule']>;
  stops: [number, NoiseCompound][];
  mu: number;
  sdL: number;
  sdR: number;
  timeMs: number;
  range: [number, number];
};

/** gen.mjs `CANDIDATES` (the rule row: mirror ahead). */
const CANDIDATES: Candidate[] = [
  { source: 'dp', stops: [[20, 'hard']], mu: 7.42, sdL: 1.6, sdR: 1.9, timeMs: 0, range: [12, 24] },
  { source: 'neighbour', stops: [[19, 'hard']], mu: 7.44, sdL: 1.6, sdR: 1.9, timeMs: 600, range: [12, 23] },
  { source: 'neighbour', stops: [[21, 'hard']], mu: 7.45, sdL: 1.6, sdR: 1.9, timeMs: 900, range: [12, 25] },
  { source: 'rule', rule: 'mirrorAhead', stops: [[18, 'hard']], mu: 7.64, sdL: 1.6, sdR: 1.9, timeMs: 1_700, range: [12, 22] },
  { source: 'neighbour', stops: [[22, 'hard']], mu: 7.78, sdL: 1.5, sdR: 2.1, timeMs: 1_400, range: [12, 26] },
  { source: 'dp', stops: [[16, 'hard'], [31, 'medium']], mu: 7.93, sdL: 1.8, sdR: 2.0, timeMs: 3_200, range: [12, 20] },
  { source: 'dp', stops: [[14, 'hard']], mu: 8.35, sdL: 1.7, sdR: 2.0, timeMs: 2_600, range: [12, 20] },
  { source: 'dp', stops: [[26, 'hard']], mu: 8.81, sdL: 1.6, sdR: 2.3, timeMs: 4_100, range: [12, 28] },
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
  /** The rule row is a `cover` rule on this car (RIVAL: #44 in slot 3): its policy gains the rival trigger last (`COVER #44 1.0 s`). */
  rival?: CarId;
};

const stopsKey = (stops: [number, NoiseCompound][]): string => stops.map(([l, c]) => `L${l} ${c.charAt(0).toUpperCase()}`).join(' ');

const first = <T>(a: T[]): T => {
  const [x] = a;
  if (x === undefined) throw new Error('no row');
  return x;
};

/** A ranked strategy table as `strategy` publishes it for KUH. */
export function table(spec: TableSpec = {}): PlanTable {
  const { committed, openTie = false, allTied = false, n = 8, infeasible = null, rival } = spec;
  const candidates = rival !== undefined ? CANDIDATES.map((c): Candidate => (c.source === 'rule' ? { ...c, rule: 'cover' } : c)) : CANDIDATES;
  const drawn = (openTie ? candidates.map((c, i) => (i === 1 ? { ...c, mu: 7.43 } : i === 2 ? { ...c, mu: 7.56 } : c)) : candidates).map(draw);
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
  const rows: McRow[] = ordered.map((r, i) => {
    const isCommitted = i === committedAt;
    const own = triggersOf(r.range[0], r.range[1]);
    const triggers = rival !== undefined && r.rule === 'cover' ? [...own, coverTrigger(rival)] : own;
    const policy: Policy = { stops: r.stops.map(([lap, compound]) => ({ lap, compound })), triggers };
    const tie = groupSize > 1 && i < groupSize;
    return {
      policy,
      source: isCommitted ? 'committed' : r.source,
      positionPmf: r.pmf,
      ePos: r.ePos,
      ePoints: r.ePoints,
      meanMs: 4_980_000 + r.timeMs,
      quantiles: { p10: quantile(r.pmf, 0.1), p50: quantile(r.pmf, 0.5), p90: quantile(r.pmf, 0.9) },
      pGain: sum(r.pmf.slice(0, OUR_PLACE - 1)),
      triggers: policy.triggers.map((t) => ({ kind: t.kind, fired: 0.1, worthPos: 0.05 })),
      diff: r.ePos - leader.ePos,
      se: SE,
      tie,
      committed: isCommitted,
      infeasible: isCommitted ? infeasible : null,
      rank: tie ? 1 : i + 1,
      deltaLeaderMs: r.timeMs - leader.timeMs,
      deltaPlanMs: planMs === null ? null : r.timeMs - planMs,
      rule: !isCommitted && r.source === 'rule' ? (r.rule ?? null) : null,
    };
  });
  const scenarios = spec.scenarios ?? (openTie ? 5_000 : 2_840);
  return {
    rows,
    scenarios,
    capHit: scenarios >= 5_000,
    candidates: 14,
    hazard: known('ok' as const, at),
    unresolvedTie: openTie,
    currentPosition: OUR_PLACE,
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
/** The rule row a `cover` rule on #44 (slot 3): its info rows show `COVER #44 1.0 s`, TRG 4. */
export const RIVAL_TABLE = table({ rival: RIVAL });

/** The gallery's synthetic cases (data states only: a highlight is window-local, a component test, P17). */
export const cases = {
  // The mockup's first figure (the screenshot baseline): no highlight, the three tied stop laps under one bracket.
  noHighlight: { plan: plan(), cars: FIELD },
  // L19 H committed: its line white, its list row `plan` with the bar; ΔPLAN in the info rows.
  committed: { plan: plan({ committed: 'L19 H' }), cars: FIELD },
  // A near-tie unresolved at the cap: the bracket and N amber.
  openTie: { plan: plan({ openTie: true }), cars: FIELD },
  // Outside the race phase (or our car in the pit lane): the kit's mark with its reason.
  notApplicable: { plan: computed(unknown('notApplicable')), cars: FIELD },
  // The job before its first result: no value; the panel frame shows its computing state ("no data yet").
  computing: { cars: FIELD },
  // Review Focus 6: one row; every row tied; the committed plan no longer feasible (its stop lap passed).
  oneRow: { plan: plan({ n: 1 }), cars: FIELD },
  allTied: { plan: plan({ allTied: true }), cars: FIELD },
  infeasible: { plan: plan({ committed: 'L14 H', infeasible: 'stopLapPassed' }), cars: FIELD },
  // The rule row covers #44 (slot 3): its trigger names the race number, never the slot (shown with a highlight).
  rival: { plan: plan({ rival: RIVAL }), cars: FIELD },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 46×6, full 88×13) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 46, rows: 6 },
  { mode: 'compact', cols: 60, rows: 8 },
  { mode: 'full', cols: 88, rows: 13 },
  { mode: 'full', cols: 110, rows: 18 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
