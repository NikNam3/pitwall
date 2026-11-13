// Builders and cases shared by the undercut-card gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the approved mockup's (docs/design/2026-11-12-sp4.3b/undercut-card.html, gen.mjs `RIVALS`,
// `undercutLines`): Spa L14/44, KUH P8; NOR 1.2 s and ALB 2.6 s ahead, HUL 0.9 s behind, GAS 3.4 s behind out of range.
// Per rival and N = 1–3 the gain distribution is gen.mjs' `binned` normal (sd 0.9 s) over `UNDERCUT_GAIN_BINS`, P(ahead)
// gen.mjs' `1 − cdf(±gap)`; both written as `undercut` fills them (spec §9.1). The display computes none of it (C65).
import type { CarOverview, Computed } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown, UNDERCUT_GAIN_BINS } from '@pitwall/domain';
import type { CarId, Known, Undercut, UndercutCase, UndercutRival } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_860_000);

/** The undercut card's value for one car (the known part of `undercut.car`). */
export type UndercutValue = Undercut;

/** Our place now and the lap (gen.mjs `OUR_PLACE`, `NOW`). */
export const OUR_PLACE = 8;
export const NOW_LAP = 14;
/** The range searched (the mockup's hover `no car within 3.0 s`). */
export const RANGE_MS = 3_000;
/** gen.mjs `GAIN_SD`. */
const GAIN_SD_S = 0.9;

/** gen.mjs `erf` and `cdf`. */
const erf = (x: number): number => {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return x >= 0 ? y : -y;
};
const cdf = (x: number, mu: number, sd: number): number => 0.5 * (1 + erf((x - mu) / (sd * Math.SQRT2)));
/** gen.mjs `binned` over `UNDERCUT_GAIN_BINS` (seconds). */
const binned = (mu: number): number[] => {
  const lo = UNDERCUT_GAIN_BINS.fromMs / 1000;
  const w = UNDERCUT_GAIN_BINS.stepMs / 1000;
  return Array.from({ length: UNDERCUT_GAIN_BINS.count }, (_, k) => cdf(lo + (k + 1) * w, mu, GAIN_SD_S) - cdf(lo + k * w, mu, GAIN_SD_S));
};

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

/** Our car (KUH, slot 0, #12) and the rivals by slot (none equal to its race number). */
export const KUH = carId(0);
export const NOR = carId(4);
export const ALB = carId(6);
export const HUL = carId(7);
export const GAS = carId(8);
/** The field of `cars.overview`: codes from the names (KUH, NOR, ALB, HUL, GAS). */
export const FIELD: CarOverview[] = [
  overview(0, 'Nikolas Kuhnlein', 12), overview(4, 'Lando Norris', 4), overview(6, 'Alexander Albon', 23),
  overview(7, 'Nico Hulkenberg', 27), overview(8, 'Pierre Gasly', 10),
];

type RivalSpec = { carId: CarId; place: number; gapS: number; ahead: boolean; n: number[]; rej: number[] };

/** gen.mjs `RIVALS` (in place order); GAS 3.4 s behind is out of range and absent. */
const RIVALS: RivalSpec[] = [
  { carId: ALB, place: 6, gapS: 2.6, ahead: true, n: [0.7, 1.4, 2.0], rej: [13, 13, 13] },
  { carId: NOR, place: 7, gapS: 1.2, ahead: true, n: [0.9, 1.6, 2.2], rej: [13, 13, 13] },
  { carId: HUL, place: 9, gapS: 0.9, ahead: false, n: [-0.6, -1.2, -1.9], rej: [12, 12, 11] },
];

const ns = [1, 2, 3] as const;

function rival(r: RivalSpec): UndercutRival {
  const aheadFromGainMs = Math.round((r.ahead ? r.gapS : -r.gapS) * 1000);
  const cases = r.n.map((mu, i): UndercutCase => {
    // ahead: we pass when the gain exceeds its gap; behind: we stay ahead while its gap plus our gain stays above zero
    const pAhead = 1 - cdf(aheadFromGainMs / 1000, mu, GAIN_SD_S);
    return {
      n: ns[i] ?? 3,
      gainMs: known(Math.round(mu * 1000), at),
      pAhead: known(pAhead, at),
      gainBins: known(binned(mu), at),
      rejoinPosition: known(r.rej[i] ?? 20, at),
    };
  });
  return { carId: r.carId, side: r.ahead ? 'ahead' : 'behind', position: r.place, gapMs: Math.round(r.gapS * 1000), aheadFromGainMs, cases };
}

/** `undercut.car` for KUH as `undercut` publishes it. */
export function undercut(rivals: UndercutRival[] = RIVALS.map(rival)): Undercut {
  return { carId: KUH, lap: NOW_LAP, position: OUR_PLACE, rangeMs: RANGE_MS, rivals };
}

/** The mockup's first figure: ALB and NOR ahead, HUL behind. */
export const RIVALS_VALUE = undercut();
/** No car within range: our line alone. */
export const NO_RIVAL = undercut([]);
/**
 * Review Focus 3 and C3: HUL's N = 2 and N = 3 cases are absent (its stop lap past the last lap: no case, never zero), and
 * NOR's N = 3 rejoin place is unknown (`insufficientData`).
 */
export const PARTIAL = undercut(
  RIVALS.map(rival).map((r): UndercutRival => {
    if (r.carId === HUL) return { ...r, cases: r.cases.filter((c) => c.n === 1) };
    if (r.carId === NOR) return { ...r, cases: r.cases.map((c) => (c.n === 3 ? { ...c, rejoinPosition: unknown('insufficientData') as Known<number> } : c)) };
    return r;
  }),
);

/** The job's result as `undercut.car` publishes it (C51). */
export const computed = (value: Known<Undercut>): Computed<Known<Undercut>> => ({ computedFor: { lap: NOW_LAP, frameId: 41_000 }, value });
export const call = (value: Undercut = RIVALS_VALUE): Computed<Known<Undercut>> => computed(known(value, at));

/** The gallery's synthetic cases (data states only). */
export const cases = {
  // The mockup's first figure (the screenshot baseline): NOR 1.2 s and ALB 2.6 s ahead, HUL 0.9 s behind.
  rivals: { undercut: call(), cars: FIELD },
  // No car within 3.0 s: our line alone, the range on hover.
  noRival: { undercut: call(NO_RIVAL), cars: FIELD },
  // Outside the race phase, under a neutralisation or with our car in the pit lane: the kit's mark with its reason.
  notApplicable: { undercut: computed(unknown('notApplicable')), cars: FIELD },
  // The job before its first result: no value; the panel frame shows its computing state ("no data yet").
  computing: { cars: FIELD },
  // Cases absent near the flag and an unknown rejoin place.
  partial: { undercut: call(PARTIAL), cars: FIELD },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums (compact 26×5, full 47×11) plus a larger one per mode. */
export const fit = [
  { mode: 'compact', cols: 26, rows: 5 },
  { mode: 'compact', cols: 34, rows: 7 },
  { mode: 'full', cols: 47, rows: 11 },
  { mode: 'full', cols: 60, rows: 14 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
