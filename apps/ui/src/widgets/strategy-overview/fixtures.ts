// Builders and cases shared by the strategy-overview gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-16-sp4.3d/strategy-overview.html, gen.mjs `FIELD`): Spa L14/44,
// KUH (P8, slot 0) the link's car, LIN (P11, slot 1) the teammate; the cars within one green pit loss (21.8 s) of KUH in
// race order. Values are written by hand from `StrategyOverview` (spec §6.4) as `strategy-overview` fills them: our row's
// gap `notApplicable`, `pastStints` the closed stints only (the current one is `compound` and `tyreAge`), `plan` only on our
// rows (R4: a = the active plan, b = the first other saved slot). The display computes none of it (C65).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  CarId, FeedId, Known, NoiseCompound, OverviewRow, Policy, SessionState, SessionUid, StrategyOverview, UnknownReason, VisualCompound,
} from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);
const k = <T>(v: T): Known<T> => known(v, at);

/** The lap now and the race's laps (gen.mjs `NOW`, `FLAG`). */
export const NOW_LAP = 14;
export const FLAG = 44;
/** The green pit loss (gen.mjs: 21.8 s). */
export const LOSS_MS = 21_800;

/** Car slots; no slot equals its race number. */
export const KUH = carId(0);
export const LIN = carId(1);
export const ALO = carId(3);
export const NOR = carId(4);
export const PIA = carId(5);
export const RUS = carId(6);
export const SAI = carId(7);
export const GAS = carId(8);
export const OCO = carId(9);

/** A `cars.overview` entry: its identity and the lap it is on (the rest does not matter here). */
export function overview(slot: CarId, name: string, raceNumber: number, lap = NOW_LAP): CarOverview {
  return {
    id: slot,
    identity: {
      name, teamId: slot <= 1 ? 0 : slot, raceNumber, nationality: 0, driverId: slot, networkId: 255, myTeam: slot <= 1,
      platform: 0, telemetryPublic: slot <= 1, visibility: slot <= 1 ? 'own' : 'public',
    },
    timing: { lap } as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: 13 },
    updatedAt: {},
  };
}

/** The field of `cars.overview`: codes from the names (KUH, LIN, ALO, NOR, PIA, RUS, SAI, GAS, OCO). */
export const FIELD: CarOverview[] = [
  overview(KUH, 'Nikolas Kuhnlein', 12), overview(LIN, 'Max Lindqvist', 63), overview(ALO, 'Fernando Alonso', 14),
  overview(NOR, 'Lando Norris', 4), overview(PIA, 'Oscar Piastri', 81), overview(RUS, 'George Russell', 23),
  overview(SAI, 'Carlos Sainz', 55), overview(GAS, 'Pierre Gasly', 10), overview(OCO, 'Esteban Ocon', 31),
];

/** `session.info` with the race's laps. */
export function session(totalLaps = FLAG): SessionInfo {
  return {
    feedId: 'gallery' as FeedId, sessionUid: '1' as SessionUid, playerCar: KUH, teammateCar: LIN,
    session: { totalLaps } as unknown as SessionState, realism: true,
  };
}

/** A policy from its stops (lap the stop is made at the end of, the compound fitted). */
export const policy = (...stops: [number, NoiseCompound][]): Policy => ({ stops: stops.map(([lap, compound]) => ({ lap, compound })) });

type RowSpec = {
  carId: CarId;
  position: number;
  /** ms, + = behind KUH; `null` on KUH's own row (`notApplicable`), a reason for an unknown gap. */
  gap: number | null | UnknownReason;
  compound: VisualCompound;
  tyreAge: number;
  pastStints?: OverviewRow['pastStints'];
  owes?: boolean | UnknownReason;
  window?: { lowLap: number; midLap: number; highLap: number } | UnknownReason;
  next?: Partial<Record<NoiseCompound, number>> | UnknownReason;
  plan?: { a: Policy | null; b: Policy | null };
};

const knownOr = <T>(v: T | UnknownReason | undefined, fallback: UnknownReason): Known<T> =>
  v === undefined ? unknown(fallback) : typeof v === 'string' ? unknown(v as UnknownReason) : k(v);

/** One row as `strategy-overview` publishes it. */
export function row(s: RowSpec): OverviewRow {
  const pastStints = s.pastStints ?? [];
  return {
    carId: s.carId,
    position: s.position,
    gapMs: s.gap === null ? unknown('notApplicable') : typeof s.gap === 'string' ? unknown(s.gap) : k(s.gap),
    compound: k(s.compound),
    tyreAge: k(s.tyreAge),
    stops: pastStints.length,
    owesCompound: s.owes === undefined ? k(false) : typeof s.owes === 'string' ? unknown(s.owes) : k(s.owes),
    pastStints,
    // a car that has made its stops (`rival-stops` predicts none) has no window and no odds
    window: knownOr(s.window, 'notApplicable'),
    nextCompound: knownOr(s.next, 'notApplicable'),
    plan: s.plan ?? null,
  };
}

/** Plan A and plan B of our two cars (gen.mjs `planA`, `planB`). */
export const KUH_A = policy([22, 'hard']);
export const KUH_B = policy([18, 'hard'], [33, 'soft']);
export const LIN_A = policy([21, 'hard']);
export const LIN_B = policy([17, 'hard'], [32, 'soft']);

/** gen.mjs `FIELD` around KUH, in race order: ALO has stopped (S L1–12, hards since L13) and runs to the flag. */
export const ROWS = {
  ALO: row({ carId: ALO, position: 5, gap: -15_200, compound: 'hard', tyreAge: 2, pastStints: [{ fromLap: 1, toLap: 12, compound: 'soft' }] }),
  NOR: row({ carId: NOR, position: 6, gap: -9_800, compound: 'medium', tyreAge: 14, owes: true, window: { lowLap: 16, midLap: 18, highLap: 20 }, next: { hard: 0.8, soft: 0.2 } }),
  PIA: row({ carId: PIA, position: 7, gap: -3_100, compound: 'medium', tyreAge: 14, owes: true, window: { lowLap: 18, midLap: 20, highLap: 23 }, next: { hard: 0.7, soft: 0.3 } }),
  KUH: row({ carId: KUH, position: 8, gap: null, compound: 'medium', tyreAge: 14, plan: { a: KUH_A, b: KUH_B } }),
  RUS: row({ carId: RUS, position: 9, gap: 1_400, compound: 'medium', tyreAge: 14, owes: true, window: { lowLap: 19, midLap: 21, highLap: 24 }, next: { hard: 0.9, soft: 0.1 } }),
  SAI: row({ carId: SAI, position: 10, gap: 6_000, compound: 'hard', tyreAge: 14, owes: true, window: { lowLap: 24, midLap: 27, highLap: 30 }, next: { medium: 0.6, soft: 0.4 } }),
  LIN: row({ carId: LIN, position: 11, gap: 9_500, compound: 'medium', tyreAge: 14, plan: { a: LIN_A, b: LIN_B } }),
  // GAS's window opened at L13, before now: shaded from L15
  GAS: row({ carId: GAS, position: 12, gap: 14_200, compound: 'soft', tyreAge: 14, owes: true, window: { lowLap: 13, midLap: 15, highLap: 17 }, next: { hard: 0.85, medium: 0.15 } }),
  OCO: row({ carId: OCO, position: 13, gap: 20_900, compound: 'medium', tyreAge: 14, owes: true, window: { lowLap: 20, midLap: 23, highLap: 26 }, next: { hard: 0.75, soft: 0.25 } }),
} as const;

/** The mockup's figure: nine rows in race order. */
export const OVERVIEW: StrategyOverview = { carId: KUH, lossMs: k(LOSS_MS), rows: Object.values(ROWS) };

/** The pit loss not known yet: only our two rows (the teammate always), LIN without a second saved slot (b null). */
export const OURS_ONLY: StrategyOverview = {
  carId: KUH,
  lossMs: unknown('insufficientData'),
  rows: [ROWS.KUH, { ...ROWS.LIN, gapMs: unknown('insufficientData'), plan: { a: LIN_A, b: null } }],
};

/** L02: `rival-stops` has too few laps, every window and odds unknown; KUH without any plan yet (a and b null). */
export const EARLY: StrategyOverview = {
  carId: KUH,
  lossMs: k(LOSS_MS),
  rows: [
    row({ carId: NOR, position: 7, gap: -1_200, compound: 'medium', tyreAge: 2, owes: 'insufficientData', window: 'insufficientData', next: 'insufficientData' }),
    row({ carId: KUH, position: 8, gap: null, compound: 'medium', tyreAge: 2, plan: { a: null, b: null } }),
    row({ carId: RUS, position: 9, gap: 900, compound: 'medium', tyreAge: 2, owes: 'insufficientData', window: 'insufficientData', next: 'insufficientData' }),
  ],
};
export const EARLY_LAP = 2;

/** The overview as LIN's panel sees it (link primary LIN): LIN has the bar, KUH is the teammate. */
export const FOR_LIN: StrategyOverview = {
  carId: LIN,
  lossMs: k(LOSS_MS),
  rows: [
    { ...ROWS.KUH, gapMs: k(-9_500) },
    { ...ROWS.RUS, gapMs: k(-8_100) },
    { ...ROWS.SAI, gapMs: k(-3_500) },
    { ...ROWS.LIN, gapMs: unknown('notApplicable') },
    { ...ROWS.GAS, gapMs: k(4_700) },
    { ...ROWS.OCO, gapMs: k(11_400) },
  ],
};

/** The field at another lap: every car on `lap`. */
export const fieldAt = (lap: number): CarOverview[] => FIELD.map((c) => overview(c.id, c.identity.name, c.identity.raceNumber, lap));

/** The gallery's synthetic cases (data states only). */
export const cases = {
  // The mockup's figure (the screenshot baseline): Spa L14/44 around KUH.
  field: { overview: OVERVIEW, cars: FIELD, session: session() },
  // The pit loss unknown: our two rows only, LIN without plan B.
  oursOnly: { overview: OURS_ONLY, cars: FIELD, session: session() },
  // L02: every rival's window and odds unknown (the kit's mark), KUH without a plan.
  early: { overview: EARLY, cars: fieldAt(EARLY_LAP), session: session() },
  // LIN's panel (link group 2): LIN has the bar, KUH is white.
  forLin: { overview: FOR_LIN, cars: FIELD, session: session() },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 28×10, full 71×10) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 28, rows: 10 },
  { mode: 'compact', cols: 40, rows: 12 },
  { mode: 'full', cols: 71, rows: 10 },
  { mode: 'full', cols: 90, rows: 14 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
