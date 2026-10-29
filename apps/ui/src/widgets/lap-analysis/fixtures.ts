// Builders shared by the lap-analysis gallery and its tests (test-phase file: the implementer does not edit it).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, known, toSessionTime, unknown } from '@pitwall/domain';
import type { CarId, LapBoard, LapBoardRow, Known, Ms, SessionBestTime } from '@pitwall/domain';

const at = toSessionTime(1000);
export const ms = (n: number): Known<Ms> => known(n, at);
const none = (reason: 'notReceived' | 'notApplicable' | 'realism' = 'notReceived') => unknown(reason);

type Times = { best: number; sectors: [number, number, number]; theo: number };

/** A `cars.overview` entry with only the identity that matters here. */
export function overview(id: number, name: string): CarOverview {
  return {
    id: carId(id),
    identity: {
      name, teamId: 0, raceNumber: id + 1, nationality: 0, ai: true, driverId: id, networkId: 255, myTeam: false,
      platform: 0, telemetryPublic: true, driverKey: { kind: 'ai', driverId: id }, visibility: 'public',
    },
    timing: {} as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: 'medium', age: 10 },
    updatedAt: {},
  };
}

/** A board row: absolute times and the deltas to `ref` computed here (positive = slower than the reference). */
export function boardRow(id: number, t: Times | 'realism' | 'noTimes', ref: Times): LapBoardRow {
  const unknownRow = (reason: 'notReceived' | 'realism'): LapBoardRow => ({
    carId: carId(id), lastLapMs: none(reason), lastSectorsMs: [none(reason), none(reason), none(reason)],
    lastSectorStatus: ['none', 'none', 'none'], lastLapStatus: 'none', bestLapMs: none(reason),
    bestSectorsMs: [none(reason), none(reason), none(reason)], theoreticalBestMs: none(reason),
    deltaToReference: { bestLapMs: none(reason), bestSectorsMs: [none(reason), none(reason), none(reason)], theoreticalBestMs: none(reason) },
  });
  if (t === 'realism') return unknownRow('realism');
  if (t === 'noTimes') return unknownRow('notReceived');
  const d = (a: number, b: number) => ms(a - b);
  return {
    ...unknownRow('notReceived'),
    lastLapMs: ms(t.best + 400),
    bestLapMs: ms(t.best),
    bestSectorsMs: [ms(t.sectors[0]), ms(t.sectors[1]), ms(t.sectors[2])],
    theoreticalBestMs: ms(t.theo),
    deltaToReference: {
      bestLapMs: d(t.best, ref.best),
      bestSectorsMs: [d(t.sectors[0], ref.sectors[0]), d(t.sectors[1], ref.sectors[1]), d(t.sectors[2], ref.sectors[2])],
      theoreticalBestMs: d(t.theo, ref.theo),
    },
  };
}

const holder = (id: number, time: number): Known<SessionBestTime> => known({ ms: time, carId: carId(id) }, at);

/** A board with the given session-best holders (`undefined` = not known yet). */
export const lapBoard = (
  reference: number,
  rows: LapBoardRow[],
  sessionBest: { lap?: [number, number]; sectors?: [[number, number]?, [number, number]?, [number, number]?] } = {},
): LapBoard => ({
  referenceCarId: carId(reference) as CarId,
  rows,
  sessionBest: {
    lap: sessionBest.lap ? holder(...sessionBest.lap) : none(),
    sectors: [0, 1, 2].map((i) => {
      const s = sessionBest.sectors?.[i];
      return s ? holder(...s) : none();
    }) as LapBoard['sessionBest']['sectors'],
  },
});

/** A `session.info` value: only the cars that are ours matter here. */
export const sessionInfo = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({
    feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(playerCar),
    ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }),
    realism: false,
  }) as SessionInfo;

/** The mockup's field: KUH (id 1, ours) is the reference. */
export const KUH: Times = { best: 104_876, sectors: [28_150, 41_288, 35_438], theo: 104_876 };
export const VER: Times = { best: 104_120, sectors: [28_104, 41_311, 35_497], theo: 104_305 };
export const NOR: Times = { best: 104_302, sectors: [28_211, 41_402, 35_418], theo: 104_443 };
export const LEC: Times = { best: 104_598, sectors: [28_240, 41_630, 35_338], theo: 104_770 };
export const PIA: Times = { best: 104_701, sectors: [28_402, 41_771, 35_487], theo: 105_072 };
export const cars = [
  overview(0, 'Max Verstappen'), overview(1, 'Nikolas Kuhnlein'), overview(2, 'Lando Norris'),
  overview(3, 'Charles Leclerc'), overview(4, 'Oscar Piastri'),
];
/** Session bests as in the mockup: VER lap and S1, KUH S2, LEC S3. */
export const sessionBests = { lap: [0, VER.best] as [number, number], sectors: [[0, 28_104], [1, 41_288], [3, 35_338]] as [[number, number], [number, number], [number, number]] };
