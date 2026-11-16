// Builders and cases shared by the circle-of-doom gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-16-sp4.3d/circle-of-doom.html and strategy-workbook.html, gen.mjs
// `CARS`, `SPUN`, `LOSS`, `rejoinAt`, `fromLin`): Spa L14/44, one lap 106 s, KUH (P8, slot 0) and LIN (P11, slot 1) our
// cars. Every value is the topic's own, written by hand as `circle` fills it (rulings R15, R16): a car's `behindMs` is
// how long ago our car was where it is now, folded into `lapMs`; our car is not in `cars`; a ghost's `behindMs` is
// `rejoin`'s loss folded into the lap, with `rejoin`'s rejoin position and the intervals to the car ahead and behind.
// The display computes none of it (C65).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { CarId, Circle, CircleCar, CircleGhost, FeedId, Known, Ms, PitCondition, SessionState, SessionUid, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);
const k = <T>(v: T): Known<T> => known(v, at);

/** One turn of the circle: our rolling lap (gen.mjs `LAP_MS`). */
export const LAP_MS = 106_000;

/** The field: code, slot (no slot equals its race number), full name (the code is its last word's first three letters), race number. */
const DRIVERS = [
  ['KUH', 0, 'Nikolas Kuhnlein', 12], ['LIN', 1, 'Max Lindqvist', 63], ['RUS', 2, 'George Russell', 6],
  ['SAI', 3, 'Carlos Sainz', 55], ['GAS', 4, 'Pierre Gasly', 10], ['OCO', 5, 'Esteban Ocon', 31], ['TSU', 6, 'Yuki Tsunoda', 22],
  ['ALB', 7, 'Alexander Albon', 23], ['HUL', 8, 'Nico Hulkenberg', 27], ['STR', 9, 'Lance Stroll', 18], ['BOT', 10, 'Valtteri Bottas', 77],
  ['ZHO', 11, 'Guanyu Zhou', 24], ['MAG', 12, 'Kevin Magnussen', 20], ['PER', 13, 'Sergio Perez', 11], ['VER', 14, 'Max Verstappen', 1],
  ['HAM', 15, 'Lewis Hamilton', 44], ['LEC', 16, 'Charles Leclerc', 16], ['ALO', 17, 'Fernando Alonso', 14], ['NOR', 18, 'Lando Norris', 4],
  ['PIA', 19, 'Oscar Piastri', 81],
] as const;
export type Code = (typeof DRIVERS)[number][0];

/** A car's slot by its code. */
export const slotOf = (code: Code): CarId => carId(DRIVERS.findIndex(([c]) => c === code));
export const KUH = slotOf('KUH');
export const LIN = slotOf('LIN');

/** A `cars.overview` entry: its identity (the rest does not matter here). */
function overview(slot: number, name: string, raceNumber: number): CarOverview {
  return {
    id: carId(slot),
    identity: {
      name, teamId: slot <= 1 ? 0 : slot, raceNumber, nationality: 0, driverId: slot, networkId: 255, myTeam: slot <= 1,
      platform: 0, telemetryPublic: slot <= 1, visibility: slot <= 1 ? 'own' : 'public',
    },
    timing: { lap: 14 } as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: 13 },
    updatedAt: {},
  };
}

/** `cars.overview`: every car of the field. */
export const FIELD: CarOverview[] = DRIVERS.map(([, slot, name, n]) => overview(slot, name, n));

/** `session.info`: KUH the player, LIN the teammate. */
export const session: SessionInfo = {
  feedId: 'gallery' as FeedId, sessionUid: '1' as SessionUid, playerCar: KUH, teammateCar: LIN,
  session: { totalLaps: 44 } as unknown as SessionState, realism: true,
};

/** KUH's circle at L14 (gen.mjs `CARS`): every other car's time behind KUH, ms. */
export const KUH_TIMES: Readonly<Partial<Record<Code, number>>> = {
  RUS: 1_400, SAI: 6_000, LIN: 9_500, GAS: 14_200, OCO: 20_900, TSU: 23_500, ALB: 27_000, HUL: 31_000, STR: 36_000, BOT: 41_000,
  ZHO: 47_000, MAG: 55_000, PER: 66_000, VER: 70_500, HAM: 78_000, LEC: 84_000, ALO: 90_800, NOR: 96_200, PIA: 102_900,
};
/** 6 s later OCO has spun and sits 4.6 s further back (gen.mjs `SPUN`). */
export const SPUN_TIMES: Readonly<Partial<Record<Code, number>>> = { ...KUH_TIMES, OCO: 25_500 };
/** LIN's circle: the same field seen from LIN, 9.5 s behind KUH (gen.mjs `fromLin`); KUH the teammate. */
export const LIN_TIMES: Readonly<Partial<Record<Code, number>>> = Object.fromEntries([
  ['KUH', LAP_MS - 9_500],
  ...Object.entries(KUH_TIMES).filter(([c]) => c !== 'LIN').map(([c, t]) => [c, (t - 9_500 + LAP_MS) % LAP_MS]),
]);
/** LIN's circle with KUH, RUS and PIA within 1 s: a group too tight to fan. */
export const TIGHT_TIMES: Readonly<Partial<Record<Code, number>>> = { ...LIN_TIMES, PIA: 96_000, KUH: 96_500, RUS: 97_000 };

/** The topic's cars from a code → time map, in the map's order. */
export const carsOf = (times: Readonly<Partial<Record<Code, number>>>): CircleCar[] =>
  Object.entries(times).map(([c, t]) => ({ carId: slotOf(c as Code), behindMs: t as Ms }));

/** A ghost's known values: its place behind us, its rejoin position, the intervals to the car ahead and behind (ms). */
type GhostValues = [behindMs: number, place: number, aheadMs: number, behindCarMs: number];
export const ghost = (condition: PitCondition, [behind, place, ahead, after]: GhostValues): CircleGhost => ({
  condition, behindMs: k<Ms>(behind), rejoinPosition: k(place), aheadMs: k<Ms>(ahead), behindCarMs: k<Ms>(after),
});
/** A ghost whose every value is unknown with one reason. */
export const unknownGhost = (condition: PitCondition, reason: UnknownReason): CircleGhost => ({
  condition, behindMs: unknown(reason), rejoinPosition: unknown(reason), aheadMs: unknown(reason), behindCarMs: unknown(reason),
});

/**
 * KUH's ghosts (gen.mjs `LOSS`, `rejoinAt` from P8): G 22.3 s → P13, 1.4 s behind OCO, 1.2 s ahead of TSU; V 13.5 s →
 * P11, 4.0 behind LIN, 0.7 ahead of GAS; S 9.8 s → P11, 0.3 behind LIN, 4.4 ahead of GAS.
 */
const KUH_VSC = ghost('vsc', [13_500, 11, 4_000, 700]);
const KUH_SC = ghost('sc', [9_800, 11, 300, 4_400]);
export const KUH_GHOSTS: CircleGhost[] = [ghost('green', [22_300, 13, 1_400, 1_200]), KUH_VSC, KUH_SC];
/** After OCO's spin: G now rejoins P12, 8.1 s behind GAS, 3.2 s ahead of OCO; V and S as before. */
export const SPUN_GHOSTS: CircleGhost[] = [ghost('green', [22_300, 12, 8_100, 3_200]), KUH_VSC, KUH_SC];
/** LIN's ghosts (from P11): G P16 0.8 behind HUL, 4.2 ahead of STR; V P13 2.1 / 0.5; S P12 5.1 / 1.6. */
export const LIN_GHOSTS: CircleGhost[] = [
  ghost('green', [22_300, 16, 800, 4_200]), ghost('vsc', [13_500, 13, 2_100, 500]), ghost('sc', [9_800, 12, 5_100, 1_600]),
];

/** `circle.car` for one of our cars. */
export function circle(
  car: CarId, times: Readonly<Partial<Record<Code, number>>>, ghosts: CircleGhost[], current: PitCondition = 'green',
): Circle {
  return { carId: car, lapMs: k<Ms>(LAP_MS), cars: k(carsOf(times)), ghosts, current };
}

/** Our first lap: no lap of our crossings yet, so no turn of the circle and no places (ruling of Task 8). */
export const firstLap: Circle = {
  carId: KUH, lapMs: unknown('insufficientData'), cars: unknown('insufficientData'),
  ghosts: (['green', 'vsc', 'sc'] as const).map((c) => unknownGhost(c, 'insufficientData')), current: 'green',
};

/**
 * The gallery's synthetic cases, the mockup's states; its compact state is the `green` case at the compact size. The tests
 * take them from here, since only the gallery imports gallery.ts (C69).
 */
export const cases = {
  // Green running (first case: the screenshot baseline, Task 15): G white, P13 ↑1.4 ↓1.2.
  green: { circle: circle(KUH, KUH_TIMES, KUH_GHOSTS), cars: FIELD, session },
  // 6 s later, OCO spun 4.6 s back: G now P12 ↑8.1 ↓3.2.
  spun: { circle: circle(KUH, SPUN_TIMES, SPUN_GHOSTS), cars: FIELD, session },
  // SC deployed: S white, P11 ↑0.3 ↓4.4; G and V faint.
  sc: { circle: circle(KUH, KUH_TIMES, KUH_GHOSTS, 'sc'), cars: FIELD, session },
  // LIN's circle (strategy-workbook.html): KUH the white ring, KUH and RUS fanned on two rings.
  lin: { circle: circle(LIN, LIN_TIMES, LIN_GHOSTS), cars: FIELD, session },
  // LIN's circle with KUH, RUS and PIA within 1 s: KUH (the teammate) keeps its code, RUS and PIA dots.
  tight: { circle: circle(LIN, TIGHT_TIMES, LIN_GHOSTS), cars: FIELD, session },
  // Our first lap: the ring and our car only, the kit's pending mark.
  firstLap: { circle: firstLap, cars: FIELD, session },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 28×12, full 53×22) plus a size inside each mode. */
export const fit = [
  { mode: 'compact', cols: 28, rows: 12 },
  { mode: 'compact', cols: 40, rows: 14 },
  { mode: 'full', cols: 53, rows: 22 },
  { mode: 'full', cols: 70, rows: 30 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
