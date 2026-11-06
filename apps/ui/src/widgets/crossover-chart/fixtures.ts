// Builders and cases shared by the crossover-chart gallery and its tests (test-phase file: the implementer does not edit
// it). Tests import the cases from here, never `gallery.ts` (C69). The sample is the approved mockup's
// (`docs/design/2026-10-30-sp4a-displays/5-weather.html`): L34, rain since L30, the slick median rising, inters from L32;
// the dry reference 1:29.412; GAS the first car on inters faster than us (S2, L33); payback 12.3 laps. L23 is the same
// race dry: no other type faster.
import type { CarOverview } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { Crossover, CrossoverLap, EstimateSource, Known, Ms, TyreType, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(3_060_000);
export const k = <T>(value: T): Known<T> => known(value, at);

/** A `cars.overview` entry with only the identity that matters here. */
export function overview(id: number, name: string): CarOverview {
  return {
    id: carId(id),
    identity: {
      name, teamId: 0, raceNumber: id + 1, nationality: 0, driverId: id, networkId: 255, myTeam: false,
      platform: 0, telemetryPublic: true, visibility: 'public',
    },
    timing: {} as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: 10 },
    updatedAt: {},
  };
}

/** Car ids of the sample field: KUH is our car (the link's primary), GAS the first faster on inters. */
export const KUH = 0;
export const LIN = 1;
export const GAS = 10;
export const OCO = 11;

export const cars: CarOverview[] = [
  overview(KUH, 'Nikolas Kuhnlein'), overview(LIN, 'Mia Lindqvist'), overview(GAS, 'Pierre Gasly'), overview(OCO, 'Esteban Ocon'),
];

/** A median per type: a number is known, a reason unknown. */
type Median = Ms | UnknownReason;
const median = (m: Median): Known<Ms> => (typeof m === 'number' ? k(m) : unknown(m));

/** One lap number's medians; an omitted type has too few laps (`insufficientData`). */
export const lapOf = (lapNumber: number, medians: Partial<Record<TyreType, Median>>): CrossoverLap => ({
  lapNumber,
  medianMs: {
    slick: median(medians.slick ?? 'insufficientData'),
    inter: median(medians.inter ?? 'insufficientData'),
    wet: median(medians.wet ?? 'insufficientData'),
  },
});

/** The pit loss's sources, as `pit-loss` decided them (C43): the display only shows the badge. */
export const sessionSource: EstimateSource = { kind: 'session', sessionShare: 1, parts: '6 stops' };
export const calibrationSource: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0, parts: '1 stop (race 15 Oct) · 0 stops this session',
};
export const defaultSource: EstimateSource = {
  kind: 'default', note: 'Silverstone track file: community value (R3)', sessionShare: 0, parts: 'track file',
};

/** The dry reference of the sample, 1:29.412, and its 110 % line (rounded as the analysis rounds it). */
export const DRY_REF_MS = 89_412;
export const LINE_110_MS = 98_353;

/** L25–L34 of the mockup: the slick median from the dry reference up, inters from L32, no wet laps. */
export const wetLaps: CrossoverLap[] = [
  lapOf(25, { slick: 89_412 }),
  lapOf(26, { slick: 90_200 }),
  lapOf(27, { slick: 90_100 }),
  lapOf(28, { slick: 90_300 }),
  lapOf(29, { slick: 90_400 }),
  lapOf(30, { slick: 91_900 }),
  lapOf(31, { slick: 93_600 }),
  lapOf(32, { slick: 95_200, inter: 97_400 }),
  lapOf(33, { slick: 96_800, inter: 96_000 }),
  lapOf(34, { slick: 98_100, inter: 95_300 }),
];

/** L16–L23 dry: slicks only. */
export const dryLaps: CrossoverLap[] = [
  lapOf(16, { slick: 89_900 }),
  lapOf(17, { slick: 89_700 }),
  lapOf(18, { slick: 89_412 }),
  lapOf(19, { slick: 89_600 }),
  lapOf(20, { slick: 89_650 }),
  lapOf(21, { slick: 89_800 }),
  lapOf(22, { slick: 89_750 }),
  lapOf(23, { slick: 89_900 }),
];

/** The mockup at L34: we are still on slicks, 109.3 % of the dry reference; GAS on inters faster in S2 on L33. */
export const wet = (lossSource: EstimateSource = sessionSource): Crossover => ({
  ourType: k('slick'),
  byLap: wetLaps,
  dryRefMs: k(DRY_REF_MS),
  line110Ms: k(LINE_110_MS),
  ourPct: k(109.3),
  firstFaster: k({ carId: carId(GAS), type: 'inter', sector: 2, lapNumber: 33 }),
  payback: k({ laps: 12.3, lossSource }),
});

/** The same race dry at L23: no other type faster, so first faster and payback do not apply. */
export const dry: Crossover = {
  ourType: k('slick'),
  byLap: dryLaps,
  dryRefMs: k(DRY_REF_MS),
  line110Ms: k(LINE_110_MS),
  ourPct: k(100.6),
  firstFaster: unknown('notApplicable'),
  payback: unknown('notApplicable'),
};

/** Every field `notApplicable`: a rival linked as the primary car, or any session other than the race (B8). */
export const notApplicable: Crossover = {
  ourType: unknown('notApplicable'),
  byLap: [],
  dryRefMs: unknown('notApplicable'),
  line110Ms: unknown('notApplicable'),
  ourPct: unknown('notApplicable'),
  firstFaster: unknown('notApplicable'),
  payback: unknown('notApplicable'),
};

// ---- the cases (the gallery's, in its order; the first is the screenshot baseline, Task 14) ----

export const cases = {
  // The approved mockup at L34: slick median rising since the rain at L30, inters from L32; US 109.3 % of 1:29.412;
  // first faster GAS on inters in S2 on L33; payback 12.3 laps on a pit loss measured this session (no badge mark).
  wet: { crossover: wet(), cars },
  // The mockup's dry case at L23: slicks only; first faster and payback not applicable (the kit's unknown mark).
  dry: { crossover: dry, cars },
  // A rival linked as the primary car: the analysis answers only our cars, every field not applicable, no line.
  rival: { crossover: notApplicable, cars },
  // L34 with the pit loss from the calibration set `league`: the payback carries the ᶜ badge.
  wetOnCalibration: { crossover: wet(calibrationSource), cars },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the mockup's two minimums plus sizes just inside each mode. */
export const fit = [
  { mode: 'compact', cols: 40, rows: 3 },
  { mode: 'compact', cols: 71, rows: 15 },
  { mode: 'full', cols: 72, rows: 16 },
  { mode: 'full', cols: 96, rows: 24 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
