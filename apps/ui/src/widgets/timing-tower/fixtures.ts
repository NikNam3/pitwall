// Builders shared by the timing-tower gallery and its row tests (test-phase file: the implementer does not edit it).
import type { CarOverview } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  CarId, CarTiming, Interval, GapToCar, LapBoard, LapBoardRow, Ms, SectorStatus, VisualCompound,
} from '@pitwall/domain';

const at = toSessionTime(1000);
export const ms = (n: number): ReturnType<typeof known<Ms>> => known(n, at);

type CarOptions = {
  name: string;
  position: number;
  gridPosition?: number;
  lap?: number;
  ours?: boolean;
  compound?: VisualCompound;
  age?: number;
  numPitStops?: number;
  timePenaltyMs?: number;
  totalWarnings?: number;
  resultStatus?: CarTiming['resultStatus'];
  pitStatus?: CarTiming['pitStatus'];
  driverStatus?: CarTiming['driverStatus'];
};

/** A `cars.overview` entry; every field not named is quiet (running, no penalties). */
export function overview(id: number, o: CarOptions): CarOverview {
  return {
    id: carId(id),
    identity: {
      name: o.name, teamId: 0, raceNumber: id + 1, nationality: 0, ai: !o.ours, driverId: id, networkId: 255, myTeam: false,
      platform: 0, telemetryPublic: true, driverKey: { kind: 'ai', driverId: id }, visibility: o.ours === true ? 'own' : 'public',
    },
    timing: {
      position: o.position, lap: o.lap ?? 23, lapDistanceM: 1000, totalDistanceM: 100_000, currentLapTimeMs: 30_000,
      lastLapTimeMs: 105_000, sector: 1, sector1TimeMs: 0, sector2TimeMs: 0, currentLapInvalid: false, gapToLeaderMs: 0,
      gapToCarAheadMs: 0, safetyCarDeltaMs: 0, pitStatus: o.pitStatus ?? 'none', numPitStops: o.numPitStops ?? 1,
      pitLaneTimerActive: false, pitLaneTimeMs: 0, pitStopTimerMs: 0, shouldServePenalty: false,
      driverStatus: o.driverStatus ?? 'onTrack', resultStatus: o.resultStatus ?? 'active', timePenaltyMs: o.timePenaltyMs ?? 0,
      totalWarnings: o.totalWarnings ?? 0, cornerCuttingWarnings: 0, unservedDriveThroughs: 0, unservedStopGos: 0,
      gridPosition: o.gridPosition ?? o.position, speedTrapFastestKmh: unknown('notReceived'), fiaFlag: 'none',
    },
    tyres: { actualCompound: 'C3', visualCompound: o.compound ?? 'medium', age: o.age ?? 14 },
    updatedAt: {},
  };
}

/** A `gaps.intervals` entry; times in ms, `undefined` = unknown (the leader has no car ahead). */
export function interval(id: number, toLeader?: number, toAhead?: number, lapsDown = 0): Interval {
  return {
    carId: carId(id),
    toLeaderMs: toLeader === undefined ? unknown('notApplicable') : ms(toLeader),
    toAheadMs: toAhead === undefined ? unknown('notApplicable') : ms(toAhead),
    toBehindMs: unknown('notApplicable'),
    lapsDown,
  };
}

/** A `gaps.toCar` entry; positive = behind our car. */
export const toCar = (id: number, gapMs: number | undefined, lapsDown = 0): GapToCar => ({
  carId: carId(id), gapMs: gapMs === undefined ? unknown('notApplicable') : ms(gapMs), lapsDown,
});

/** A lap-board row; `last` is the last lap in ms (`undefined` = unknown, `'realism'` = withheld). */
export function boardRow(
  id: number,
  last: number | 'realism' | undefined,
  sectors: [number?, number?, number?] = [],
  status: [SectorStatus, SectorStatus, SectorStatus] = ['none', 'none', 'none'],
  lapStatus: SectorStatus = 'none',
): LapBoardRow {
  const time = (v: number | 'realism' | undefined) =>
    v === 'realism' ? unknown('realism') : v === undefined ? unknown('notReceived') : ms(v);
  const hidden = last === 'realism';
  const s = (v: number | undefined) => (hidden ? unknown('realism') : time(v));
  const unknownDelta = unknown('notApplicable');
  return {
    carId: carId(id),
    lastLapMs: time(last),
    lastSectorsMs: [s(sectors[0]), s(sectors[1]), s(sectors[2])],
    lastSectorStatus: status,
    lastLapStatus: lapStatus,
    bestLapMs: unknown('notReceived'),
    bestSectorsMs: [unknown('notReceived'), unknown('notReceived'), unknown('notReceived')],
    theoreticalBestMs: unknown('notReceived'),
    deltaToReference: { bestLapMs: unknownDelta, bestSectorsMs: [unknownDelta, unknownDelta, unknownDelta], theoreticalBestMs: unknownDelta },
  };
}

/** A lap board with no session bests. */
export const lapBoard = (reference: number, rows: LapBoardRow[]): LapBoard => ({
  referenceCarId: carId(reference) as CarId,
  rows,
  sessionBest: { lap: unknown('notReceived'), sectors: [unknown('notReceived'), unknown('notReceived'), unknown('notReceived')] },
});
