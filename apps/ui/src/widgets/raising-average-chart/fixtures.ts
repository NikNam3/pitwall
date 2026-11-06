// Builders and cases shared by the raising-average-chart gallery and its tests (test-phase file: the implementer does not
// edit it). Tests import the cases from here, never `gallery.ts` (C69). The sample follows the approved mockup
// (`docs/design/2026-11-06-sp4.1b/changes.html`, part a): Silverstone, our cars KUH (player) and LIN (teammate, both
// Williams), the rivals HAM, RUS and NOR named by the options `rival1`–`rival3`; 18 `forPace` laps each.
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import type { CarId, Ms, RaisingAverage, RaisingAverageCurve, SessionState } from '@pitwall/domain';

type Driver = { id: number; name: string; teamId: number; raceNumber: number };

/** The field: our two cars (KUH, LIN, Williams), then two cars of several other teams (ids as the track-map fixtures). */
export const DRIVERS: readonly Driver[] = [
  { id: 0, name: 'Kuhnlein', teamId: 3, raceNumber: 7 },
  { id: 1, name: 'Lindqvist', teamId: 3, raceNumber: 23 },
  { id: 2, name: 'Verstappen', teamId: 2, raceNumber: 1 },
  { id: 4, name: 'Norris', teamId: 8, raceNumber: 4 },
  { id: 5, name: 'Piastri', teamId: 8, raceNumber: 81 },
  { id: 6, name: 'Leclerc', teamId: 1, raceNumber: 16 },
  { id: 7, name: 'Hamilton', teamId: 1, raceNumber: 44 },
  { id: 8, name: 'Russell', teamId: 0, raceNumber: 63 },
];

/** Car ids by code. */
export const ID = { KUH: carId(0), LIN: carId(1), VER: carId(2), NOR: carId(4), PIA: carId(5), LEC: carId(6), HAM: carId(7), RUS: carId(8) } as const;

/** Only id and identity matter to the display; the rest of an overview is irrelevant here. */
export const overview = (d: Driver): CarOverview => ({
  id: carId(d.id),
  identity: {
    name: d.name, teamId: d.teamId, raceNumber: d.raceNumber, nationality: 0, driverId: d.id,
    networkId: 255, myTeam: false, platform: 0, telemetryPublic: true, visibility: 'public',
  } as unknown as CarOverview['identity'],
  timing: {} as CarOverview['timing'],
  tyres: {} as CarOverview['tyres'],
  updatedAt: {},
});

/** `cars.overview` of the whole sample field. */
export const field: CarOverview[] = DRIVERS.map(overview);

/** `session.info` with our player car and, when given, the teammate. */
export const sessionInfo = (playerCar: CarId, teammateCar?: CarId): SessionInfo =>
  ({
    feedId: feedId('gallery'),
    sessionUid: '1',
    playerCar,
    ...(teammateCar === undefined ? {} : { teammateCar }),
    session: {} as SessionState,
    realism: false,
  }) as unknown as SessionInfo;

/** A curve of `n` points: the best lap, then a mean that rises by `slope` and `curve` per X (never falls, as a mean of the sorted laps). */
export const points = (n: number, best: Ms, slope: number, curve: number): Ms[] =>
  Array.from({ length: n }, (_, i) => Math.round(best + slope * i + curve * i * i));

/** One car's curve. */
export const curve = (id: CarId, pointsMs: Ms[]): RaisingAverageCurve => ({ carId: id, laps: pointsMs.length, pointsMs });

/** The mockup's curves (18 laps each), plus VER and LEC, which no option names. */
export const raceCurves = {
  KUH: curve(ID.KUH, points(18, 90_412, 20, 1.2)),
  LIN: curve(ID.LIN, points(18, 90_705, 30, 1.4)),
  HAM: curve(ID.HAM, points(18, 90_300, 14, 0.4)),
  RUS: curve(ID.RUS, points(18, 90_610, 22, 1.0)),
  NOR: curve(ID.NOR, points(18, 90_450, 18, 0.5)),
  VER: curve(ID.VER, points(18, 90_380, 16, 0.6)),
  LEC: curve(ID.LEC, points(18, 90_520, 19, 0.8)),
  // PIA has a lap record but no `forPace` lap yet: an empty curve.
  PIA: curve(ID.PIA, []),
} as const;

/** The mockup's widget options: Rival 1 to 3 are HAM, RUS and NOR. */
export const raceOptions = { rival1: ID.HAM, rival2: ID.RUS, rival3: ID.NOR } as const;

// ---- the cases (the gallery's, in its order; the first is the screenshot baseline) ----

export const cases = {
  // The approved mockup: KUH and LIN white (LIN dashed); with `raceOptions` HAM, RUS and NOR in their team colours.
  race: {
    analysis: { cars: Object.values(raceCurves) } as RaisingAverage,
    cars: field,
    session: sessionInfo(ID.KUH, ID.LIN),
  },
  // A practice session with one car of ours and no teammate: KUH's line only (11 laps).
  practiceOneCar: {
    analysis: { cars: [curve(ID.KUH, points(11, 89_870, 25, 1.5))] } as RaisingAverage,
    cars: DRIVERS.slice(0, 1).map(overview),
    session: sessionInfo(ID.KUH),
  },
  // No car has a `forPace` lap yet (out laps only): every curve empty, nothing drawn.
  noLaps: {
    analysis: { cars: [curve(ID.KUH, []), curve(ID.LIN, []), curve(ID.HAM, [])] } as RaisingAverage,
    cars: field,
    session: sessionInfo(ID.KUH, ID.LIN),
  },
} as const;
