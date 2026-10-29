// Joins the topics the timing tower reads into one row per car (no arithmetic: the numbers, stops and compound included, come from the topics).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { unknown } from '@pitwall/domain';
import { ourCars } from '../../kit/car/our-cars.ts';
import { momentIncident } from './emphasis.ts';
import type {
  CarId, GapToCar, IncidentEntry, Interval, Known, LapBoard, LapBoardRow, Ms, RaceMoment, SectorStatus, VisualCompound,
} from '@pitwall/domain';

export type TowerInput = {
  cars: CarOverview[];
  intervals: Interval[];
  toCar: GapToCar[];
  board: LapBoard;
  moment?: Known<RaceMoment> | undefined;
  session: SessionInfo;
  incidents: IncidentEntry[] | undefined;
  showRetired: boolean;
};

export type TowerRow = {
  carId: CarId;
  ours: boolean;
  /** A car of the incident the incident moment names; false in every other moment. */
  involved: boolean;
  retired: boolean;
  position: number | undefined;
  /** Places gained (positive) or lost, from the gaps analysis; undefined when unknown or retired. */
  change: number | undefined;
  retiredAtLap: number | undefined;
  gapToLeader: Known<Ms>;
  interval: Known<Ms>;
  lapsDown: number;
  /** TO US: the `gaps.toCar` entry, measured to the link group's primary car; that car's own entry is `notApplicable`. */
  toUs: Pick<GapToCar, 'gapMs' | 'lapsDown'>;
  lastLap: Known<Ms>;
  lastLapStatus: SectorStatus;
  sectors: Array<{ timeMs: Known<Ms>; status: SectorStatus }>;
  compound: VisualCompound;
  age: number;
  stops: number;
  penaltyMs: number;
  warnings: number;
  pit: 'pit' | 'out' | undefined;
  overview: CarOverview;
};

const RETIRED = new Set(['didNotFinish', 'disqualified', 'notClassified', 'retired']);
const UNUSED = new Set(['invalid', 'inactive']);
const missing = (): Known<Ms> => unknown('notReceived');

function sectorsOf(row: LapBoardRow | undefined): TowerRow['sectors'] {
  return [0, 1, 2].map((i) => ({
    timeMs: row?.lastSectorsMs[i] ?? missing(),
    status: row?.lastSectorStatus[i] ?? 'none',
  }));
}

/** One row per running or retired car: running by position, then retired by car id. */
export function buildRows(input: TowerInput): TowerRow[] {
  const intervals = new Map(input.intervals.map((i) => [i.carId, i]));
  const toCar = new Map(input.toCar.map((g) => [g.carId, g]));
  const board = new Map(input.board.rows.map((r) => [r.carId, r]));
  const incident = momentIncident(input.moment, input.incidents);
  const ours = ourCars(input.session);

  const rows = input.cars
    .filter((c) => !UNUSED.has(c.timing.resultStatus))
    .map((c): TowerRow => {
      const id = c.id;
      const retired = RETIRED.has(c.timing.resultStatus);
      const gaps = intervals.get(id);
      const lap = board.get(id);
      const gained = gaps?.positionsGained;
      return {
        carId: id,
        ours: ours.has(id),
        involved: incident?.carIds.includes(id) ?? false,
        retired,
        position: retired ? undefined : c.timing.position,
        change: retired || gained === undefined || !gained.known ? undefined : gained.value,
        retiredAtLap: retired ? c.timing.lap : undefined,
        gapToLeader: gaps?.toLeaderMs ?? missing(),
        interval: gaps?.toAheadMs ?? missing(),
        lapsDown: gaps?.lapsDown ?? 0,
        toUs: toCar.get(id) ?? { gapMs: missing(), lapsDown: 0 },
        lastLap: lap?.lastLapMs ?? missing(),
        lastLapStatus: lap?.lastLapStatus ?? 'none',
        sectors: sectorsOf(lap),
        compound: c.tyres.visualCompound,
        age: c.tyres.age,
        stops: c.stops,
        penaltyMs: c.timing.timePenaltyMs,
        warnings: c.timing.totalWarnings,
        pit: c.timing.pitStatus === 'pitting' || c.timing.pitStatus === 'inPitArea' ? 'pit' : c.timing.driverStatus === 'outLap' ? 'out' : undefined,
        overview: c,
      };
    });
  const running = rows.filter((r) => !r.retired).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const out = input.showRetired ? rows.filter((r) => r.retired).sort((a, b) => a.carId - b.carId) : [];
  return [...running, ...out];
}

/** The rows that fit `capacity` lines: the top of the field, moved down just far enough to keep `ownId` (our car) in view. */
export function visibleRows(rows: TowerRow[], capacity: number, ownId: CarId): TowerRow[] {
  const room = Math.max(1, Math.floor(capacity));
  if (rows.length <= room) return rows;
  const own = rows.findIndex((r) => r.carId === ownId);
  const start = own < room ? 0 : Math.min(own - (room >> 1), rows.length - room);
  return rows.slice(start, start + room);
}
