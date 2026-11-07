// Builders and cases shared by the crossing-order gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the mockup's (docs/design/2026-10-30-sp4a-displays/1-ghost-views.html, gen.mjs `REJOIN`): Silverstone
// L23/52, our cars KUH (player, P6, the ghost) and LIN (teammate, P8); the VSC loss from the calibration (ᶜ, the mockup's
// old ˢ), the SC loss the track file's default (ᵈ). Each order holds `orderAround` = 3 cars either side of the ghost.
import type { CarOverview, MachineSpans, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { CrossingRow, EstimateSource, Known, Ms, PitCondition, Rejoin, RejoinAt, UnknownReason } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(2_075_000);
const ms = (n: number): Known<Ms> => known(n, at);

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

/** Car ids of the sample field. */
export const KUH = 0;
export const LIN = 1;
export const HAM = 2;
export const RUS = 3;
export const ALO = 4;
export const GAS = 5;
export const HAD = 6;
export const HUL = 7;
export const OCO = 8;
export const STR = 9;
export const BEA = 10;

export const cars: CarOverview[] = [
  overview(KUH, 'Nikolas Kuhnlein'), overview(LIN, 'Mia Lindqvist'), overview(HAM, 'Lewis Hamilton'),
  overview(RUS, 'George Russell'), overview(ALO, 'Fernando Alonso'), overview(GAS, 'Pierre Gasly'),
  overview(HAD, 'Isack Hadjar'), overview(HUL, 'Nico Hulkenberg'), overview(OCO, 'Esteban Ocon'),
  overview(STR, 'Lance Stroll'), overview(BEA, 'Oliver Bearman'),
];

/** A `session.info` value: only the cars that are ours matter here (KUH the player, LIN the teammate). */
export const sessionInfo: SessionInfo = {
  feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(KUH), teammateCar: carId(LIN), realism: false,
} as SessionInfo;

/** Sources as the `pit-loss` calculator decides them (C43): the display only shows the badge. */
export const sessionSource: EstimateSource = { kind: 'session', sessionShare: 0.75, parts: '6 stops + league 20.4 (75 % session)' };
export const calibrationSource: EstimateSource = {
  kind: 'calibration', setName: 'league', sources: 3, sessionShare: 0, parts: '3 stops (race 15 Oct, FP2 14 Oct) · 0 stops this session',
};
export const defaultSource: EstimateSource = {
  kind: 'default', note: 'Silverstone track file: community value (R3)', sessionShare: 0, parts: 'track file',
};

/** One order row: `[car, position, intervalMs]`; the ghost row is our car (KUH) with `ghost: true`. */
type RowSpec = readonly [car: number | 'ghost', position: number, intervalMs: number];
const row = ([car, position, intervalMs]: RowSpec): CrossingRow => ({
  carId: carId(car === 'ghost' ? KUH : car), position, intervalMs: ms(intervalMs), ghost: car === 'ghost',
});

/** The mockup's orders, three cars either side of the ghost (gen.mjs `REJOIN`, its outermost row dropped). */
export const ORDERS: Record<PitCondition, readonly RowSpec[]> = {
  green: [[GAS, 9, 3_684], [HAD, 10, 4_593], [HUL, 11, 2_779], ['ghost', 12, 612], [OCO, 13, 1_496], [STR, 14, 3_573], [BEA, 15, 3_569]],
  vsc: [[ALO, 7, 3_573], [LIN, 8, 4_079], [GAS, 9, 3_684], ['ghost', 10, 458], [HAD, 11, 4_135], [HUL, 12, 2_779], [OCO, 13, 2_396]],
  sc: [[RUS, 6, 1_304], [ALO, 7, 3_573], [LIN, 8, 4_079], ['ghost', 9, 844], [GAS, 10, 2_840], [HAD, 11, 4_593], [HUL, 12, 2_779]],
};

/** The mockup's losses and their sources per condition. */
export const LOSSES: Record<PitCondition, { lossMs: number; source: EstimateSource }> = {
  green: { lossMs: 20_300, source: sessionSource },
  vsc: { lossMs: 13_100, source: calibrationSource },
  sc: { lossMs: 9_800, source: defaultSource },
};

/** One condition of `rejoin.car`: known from the mockup, or with an unknown loss and order. */
export function rejoinAt(condition: PitCondition, unknownLoss?: UnknownReason, unknownOrder?: UnknownReason): RejoinAt {
  const ghost = ORDERS[condition].find(([car]) => car === 'ghost');
  return {
    condition,
    lossMs: unknownLoss === undefined ? ms(LOSSES[condition].lossMs) : unknown(unknownLoss),
    lossSource: LOSSES[condition].source,
    rejoinPosition: unknownOrder === undefined && ghost !== undefined ? known(ghost[1], at) : unknown(unknownOrder ?? 'insufficientData'),
    order: unknownOrder === undefined ? known(ORDERS[condition].map(row), at) : unknown(unknownOrder),
    mapPoint: unknown('notApplicable'),
  };
}

/** `rejoin.car` of KUH (P6): every condition as the mockup, or with the given unknowns in every condition. */
export const rejoin = (unknownLoss?: UnknownReason, unknownOrder?: UnknownReason): Rejoin => ({
  carId: carId(KUH),
  position: 6,
  conditions: {
    green: rejoinAt('green', unknownLoss, unknownOrder),
    vsc: rejoinAt('vsc', unknownLoss, unknownOrder),
    sc: rejoinAt('sc', unknownLoss, unknownOrder),
  },
});

/** `situation.sessionPhaseRace`: green running (a `racing` span), or a neutralisation by the SC or the VSC. */
const racing: MachineSpans = {
  open: [{ machine: 'session-phase-race', id: 1, kind: 'racing', start: toSessionTime(120_000), confirmed: true, detail: undefined, startFrame: 7_000 }],
};
export const neutralised = (car: 'SC' | 'VSC'): MachineSpans => ({
  open: [{
    machine: 'session-phase-race', id: 2, kind: 'neutralised', start: toSessionTime(2_060_000), confirmed: true,
    detail: { car, stages: [{ stage: 'deployed', at: toSessionTime(2_060_000) }] }, startFrame: 120_000,
  }],
});
export const phases = { racing, vsc: neutralised('VSC'), sc: neutralised('SC') };

const base = { cars, session: sessionInfo };

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup (first case: the screenshot baselines): green running, the three conditions side by side in full,
  // green alone in compact; HUL and OCO (directly ahead of and behind the ghost) bold.
  green: { ...base, rejoin: rejoin(), phase: phases.racing },
  // A VSC out: its title white bold; compact shows the VSC condition.
  vscOut: { ...base, rejoin: rejoin(), phase: phases.vsc },
  // An SC out: its title white bold; compact shows the SC condition; LIN (ours) directly ahead of the ghost.
  scOut: { ...base, rejoin: rejoin(), phase: phases.sc },
  // L1, no gaps yet: the titles stay, the losses and orders are empty with the reason on hover.
  unknown: { ...base, rejoin: rejoin('insufficientData', 'insufficientData'), phase: phases.racing },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums plus sizes just inside each mode (compact one column short of full, full
 *  taller and wider than its minimum). */
export const fit = [
  { mode: 'compact', cols: 20, rows: 7 },
  { mode: 'compact', cols: 53, rows: 8 },
  { mode: 'full', cols: 54, rows: 9 },
  { mode: 'full', cols: 64, rows: 12 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
