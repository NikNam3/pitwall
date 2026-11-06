// Builders and cases shared by the pit-loss-table gallery and its tests (test-phase file: the implementer does not edit it).
// The sample is the mockup's (docs/design/2026-11-06-sp4.1a/source-badge.html): Silverstone L23/52 on the set `league`,
// our cars KUH (player) and LIN (teammate).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { EstimateSource, Known, Ms, PitCondition, PitLossEstimate, PitLossStop, PitLosses } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

const at = toSessionTime(1_380_000);
export const ms = (n: number): Known<Ms> => known(n, at);

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
export const BOR = 2;
export const ANT = 3;
export const BEA = 4;
export const LAW = 5;
export const DOO = 6;
export const HAD = 7;

export const cars: CarOverview[] = [
  overview(KUH, 'Nikolas Kuhnlein'), overview(LIN, 'Mia Lindqvist'), overview(BOR, 'Gabriel Bortoleto'),
  overview(ANT, 'Kimi Antonelli'), overview(BEA, 'Oliver Bearman'), overview(LAW, 'Liam Lawson'),
  overview(DOO, 'Jack Doohan'), overview(HAD, 'Isack Hadjar'),
];

/** A `session.info` value: only the cars that are ours matter here (KUH the player, LIN the teammate; `null`: none). */
export const sessionInfo = (playerCar = KUH, teammateCar: number | null = LIN): SessionInfo =>
  ({
    feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(playerCar),
    ...(teammateCar === null ? {} : { teammateCar: carId(teammateCar) }),
    realism: false,
  }) as SessionInfo;

/** Sources as the `pit-loss` calculator decides them (C43): the display only maps the kind. */
export const sessionSource = (stops: number): EstimateSource => ({
  kind: 'session', sessionShare: stops / (stops + 2), parts: `${stops} stops + league 20.4 (75 % session)`,
});
export const calibrationSource = (parts = '1 stop (race 15 Oct) · 0 stops this session'): EstimateSource => ({
  kind: 'calibration', setName: 'league', sources: 4, sessionShare: 0, parts,
});
export const defaultSource: EstimateSource = {
  kind: 'default', note: 'Silverstone track file: community value (R3)', sessionShare: 0, parts: 'track file',
};

/** One condition's estimate; `stationaryMs` undefined = not enough stops to know it. */
export const estimate = (lossMs: number, stationaryMs: number | undefined, sessionStops: number, source: EstimateSource): PitLossEstimate => ({
  lossMs: ms(lossMs),
  stationaryMedianMs: stationaryMs === undefined ? unknown('insufficientData') : ms(stationaryMs),
  sessionStops,
  source,
});

/** One stop of the session; a `noReference` stop has no loss. */
export const stop = (car: number, lap: number, lossMs: number | undefined, stationaryMs: number, use: PitLossStop['use'] = 'used', condition: PitCondition = 'green'): PitLossStop => ({
  carId: carId(car), lap, condition, lossMs: lossMs === undefined ? unknown('insufficientData') : ms(lossMs), stationaryMs, use,
});

/** The mockup's conditions: green from 6 stops this session, VSC from the set `league`, SC the track file's default. */
export const mockupConditions: PitLosses['conditions'] = {
  green: estimate(20_300, 2_400, 6, sessionSource(6)),
  vsc: estimate(13_400, 2_500, 0, calibrationSource()),
  sc: estimate(9_800, undefined, 0, defaultSource),
};

/** The mockup's six green stops, in lap order as the topic gives them. */
export const mockupStops: PitLossStop[] = [
  stop(DOO, 12, 19_800, 2_400), stop(LAW, 14, 20_900, 2_600), stop(LIN, 15, 20_000, 2_300),
  stop(BEA, 16, 20_400, 2_400), stop(ANT, 18, 20_100, 2_300), stop(BOR, 19, 20_600, 2_500),
];

export const losses = (conditions: PitLosses['conditions'] = mockupConditions, stops: PitLossStop[] = mockupStops): PitLosses => ({ conditions, stops });

const base = { cars, session: sessionInfo() };

/** The gallery's synthetic cases; the tests take them from here, since only the gallery imports gallery.ts (C69). */
export const cases = {
  // The mockup (first case: the screenshot baseline, Task 18): green measured this session from 6 stops (no mark,
  // SOURCE "session"), VSC from the set `league` (ᶜ, "calibration"), SC the track file's default (ᵈ, "default",
  // muted, stationary unknown); the six stops newest first, LIN ours.
  measured: { ...base, losses: losses() },
  // Lights out on the set `league`: every condition from the calibration, no stop yet.
  calibration: {
    ...base,
    losses: losses({
      green: estimate(20_400, 2_400, 0, calibrationSource('3 stops (race 15 Oct, FP2 14 Oct) · 0 stops this session')),
      vsc: estimate(13_400, 2_500, 0, calibrationSource()),
      sc: estimate(9_800, undefined, 0, defaultSource),
    }, []),
  },
  // A track without a calibration set: every condition is the track file's default, every row muted, no stop yet.
  defaultsOnly: {
    ...base,
    losses: losses({
      green: estimate(21_000, undefined, 0, defaultSource),
      vsc: estimate(13_000, undefined, 0, defaultSource),
      sc: estimate(9_800, undefined, 0, defaultSource),
    }, []),
  },
  // A stop without clean reference laps (HAD, lap 21): no loss (the unknown mark), the row faint with why on hover.
  noReferenceStop: { ...base, losses: losses(mockupConditions, [...mockupStops, stop(HAD, 21, undefined, 2_400, 'noReference')]) },
  // A stop that served a penalty (KUH, lap 22): its loss shown but faint, not counted, why on hover (R12).
  penaltyStop: { ...base, losses: losses(mockupConditions, [...mockupStops, stop(KUH, 22, 25_700, 7_500, 'penalty')]) },
  // Stops under VSC and SC this session, our player's among them.
  neutralisedStops: {
    ...base,
    losses: losses(mockupConditions, [...mockupStops, stop(ANT, 30, 13_100, 2_400, 'used', 'vsc'), stop(BEA, 31, 9_600, 2_500, 'used', 'sc'), stop(KUH, 31, 9_900, 2_300, 'used', 'sc')]),
  },
} satisfies NonNullable<GalleryEntry<typeof widget>['cases']>;

/** The gallery's fit sizes: the two minimums plus sizes just inside each mode (compact one column short of full, full
 *  taller than its minimum). */
export const fit = [
  { mode: 'compact', cols: 18, rows: 3 },
  { mode: 'compact', cols: 31, rows: 12 },
  { mode: 'full', cols: 32, rows: 13 },
  { mode: 'full', cols: 40, rows: 20 },
] satisfies NonNullable<GalleryEntry<typeof widget>['fit']>;
