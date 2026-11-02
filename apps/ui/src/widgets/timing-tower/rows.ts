// Joins the topics the timing tower reads into one row per car (no arithmetic: the numbers, stops and compound included, come from the topics).
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { unknown } from '@pitwall/domain';
import { ourCars } from '../../kit/car/our-cars.ts';
import { formatPenaltyMs, formatWarnings } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { momentIncident, penaltyRole } from './emphasis.ts';
import * as text from './text.ts';
import type {
  CarId, CarTiming, GapToCar, IncidentEntry, Interval, Known, LapBoard, LapBoardRow, Ms, RaceMoment, SectorStatus, VisualCompound,
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
  /** Out of the race, as the lap board's row says (`LapBoardRow.outOfRace`); false for a car the board lacks. */
  retired: boolean;
  position: number | undefined;
  /** Places gained (positive) or lost, from the gaps analysis; undefined when unknown or retired. */
  change: number | undefined;
  retiredAtLap: number | undefined;
  gapToLeader: Known<Ms>;
  interval: Known<Ms>;
  lapsDown: number;
  /**
   * TO US: the `gaps.toCar` entry as it comes, measured to the link group's primary car; the analysis gives that car's own
   * entry and a retired car's `notApplicable`. `notReceived` for a car the topic lacks.
   */
  toUs: Pick<GapToCar, 'gapMs' | 'lapsDown'>;
  lastLap: Known<Ms>;
  lastLapStatus: SectorStatus;
  sectors: Array<{ timeMs: Known<Ms>; status: SectorStatus }>;
  compound: VisualCompound;
  age: number;
  stops: number;
  /** The PEN cell as it shows: `SG`, `DT`, the time penalty (`5s`) or the warnings (`2w`); a time beside SG/DT in the title. */
  penalty: { text: string; role?: Role | undefined; title?: string };
  pit: 'pit' | 'out' | undefined;
  overview: CarOverview;
};

const UNUSED = new Set(['invalid', 'inactive']);
const missing = (): Known<Ms> => unknown('notReceived');

function sectorsOf(row: LapBoardRow | undefined): TowerRow['sectors'] {
  return [0, 1, 2].map((i) => ({
    timeMs: row?.lastSectorsMs[i] ?? missing(),
    status: row?.lastSectorStatus[i] ?? 'none',
  }));
}

/**
 * An unserved stop-go before a drive-through before the time penalty, with the count of that kind when more than one;
 * the warning count when there is no penalty.
 */
function penaltyCell(t: CarTiming): TowerRow['penalty'] {
  const role = penaltyRole(t.timePenaltyMs, t.unservedStopGos + t.unservedDriveThroughs);
  const unserved =
    t.unservedStopGos > 0 ? { kind: text.unservedPenalty.stopGo, count: t.unservedStopGos }
    : t.unservedDriveThroughs > 0 ? { kind: text.unservedPenalty.driveThrough, count: t.unservedDriveThroughs }
    : undefined;
  const time = t.timePenaltyMs > 0 ? formatPenaltyMs(t.timePenaltyMs) : undefined;
  if (unserved !== undefined) {
    const name = unserved.kind.name(unserved.count);
    return { text: unserved.kind.code(unserved.count), role, title: time === undefined ? name : text.withTimePenalty(name, time) };
  }
  if (time !== undefined) return { text: time, role };
  return { text: t.totalWarnings > 0 ? formatWarnings(t.totalWarnings) : '' };
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
      const gaps = intervals.get(id);
      const lap = board.get(id);
      const retired = lap?.outOfRace === true;
      const gained = gaps?.positionsGained;
      const toUs = toCar.get(id);
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
        toUs: toUs === undefined ? { gapMs: missing(), lapsDown: 0 } : { gapMs: toUs.gapMs, lapsDown: toUs.lapsDown },
        lastLap: lap?.lastLapMs ?? missing(),
        lastLapStatus: lap?.lastLapStatus ?? 'none',
        sectors: sectorsOf(lap),
        compound: c.tyres.visualCompound,
        age: c.tyres.age,
        stops: c.stops,
        penalty: penaltyCell(c.timing),
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
