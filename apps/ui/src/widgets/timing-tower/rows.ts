// Joins the topics the timing tower reads into one row per car (no arithmetic: the numbers, stops and compound included,
// come from the topics; the stops are joined by car id from `pitStopCount.byCar`). Where a car is, what it does, what it owes and whether it still competes come from the situation
// topics' open spans, each kind mapped to its cell by the presentation table (C65, C66).
import type { CarOverview, MachineSpans, PitStopCounts, SessionInfo } from '@pitwall/contracts';
import { unknown } from '@pitwall/domain';
import { ourCars } from '../../kit/car/our-cars.ts';
import { openSpanOf } from '../../kit/situation.ts';
import { formatPenaltyMs, formatWarnings } from '../../kit/values/format.ts';
import type { Role } from '../../theme/roles.ts';
import { momentIncident, penaltyRole, sectorRole } from './emphasis.ts';
import { presentation, type ActivityKey, type ActivityRow, type SituationCell, type StatusRow } from './presentation.ts';
import * as text from './text.ts';
import type {
  CarId, GapToCar, IncidentEntry, Interval, Known, LapBoard, LapBoardRow, Ms, OpenSpan, PendingPenaltyDetail, RaceMoment,
  SectorStatus, ServingPenaltyDetail, TimePenaltyDetail, VisualCompound, WarnedDetail,
} from '@pitwall/domain';

export type TowerInput = {
  cars: CarOverview[];
  /** Each car's stops (`pit-stop-count`). */
  pitStops: PitStopCounts;
  intervals: Interval[];
  toCar: GapToCar[];
  board: LapBoard;
  moment?: Known<RaceMoment> | undefined;
  session: SessionInfo;
  incidents: IncidentEntry[] | undefined;
  /** The situation topics (open spans only): the weekend phase, and per car its location, status and warnings. */
  phase: MachineSpans;
  location: MachineSpans;
  status: MachineSpans;
  warnings: MachineSpans;
  /** The car-activity topics; only the weekend phase's own is read. */
  raceActivity?: MachineSpans | undefined;
  qualifyingActivity?: MachineSpans | undefined;
  practiceActivity?: MachineSpans | undefined;
  /** Race only. */
  penalties?: MachineSpans | undefined;
  showRetired: boolean;
};

export type TowerRow = {
  carId: CarId;
  ours: boolean;
  /** A car of the incident the incident moment names; false in every other moment. */
  involved: boolean;
  /** Out of the race: its car status is retired or disqualified (`car-status`). */
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
  /** The newest finished time per sector; `older` when it is of an earlier lap (dimmed). `role` is unset for an unknown sector. */
  sectors: Array<{ timeMs: Known<Ms>; status: SectorStatus; older: boolean; role?: Role | undefined }>;
  compound: VisualCompound;
  age: number;
  /** The car's stops from `pitStopCount.byCar`; undefined for a car it does not list (shown empty, C3). */
  stops: number | undefined;
  /** The PEN cell as it shows: `SG`, `DT`, the time penalty (`5s`) or the warnings (`2w`); a time beside SG/DT in the title. */
  penalty: { text: string; role?: Role | undefined; title?: string };
  /** The situation column as it shows: GARAGE, PIT, BOX, DT, SG, OUT, IN, RET, DSQ, FIN, or nothing. */
  situation: SituationCell;
  overview: CarOverview;
};

const missing = (): Known<Ms> => unknown('notReceived');
const HIDDEN: StatusRow = { row: 'hidden' };
const NONE: SituationCell = { text: text.situation.none };

/** The car-activity rows of each activity topic. */
const ACTIVITY_ROWS: Readonly<Record<ActivityKey, Readonly<Record<string, ActivityRow>>>> = {
  raceActivity: presentation.situations['car-activity-race'],
  qualifyingActivity: presentation.situations['car-activity-qualifying'],
  practiceActivity: presentation.situations['car-activity-practice'],
};

/** The presentation row of an open span's kind; `undefined` without a span. */
const rowOf = <R>(rows: Readonly<Record<string, R>>, span: OpenSpan | undefined): R | undefined => (span === undefined ? undefined : rows[span.kind]);

function sectorsOf(row: LapBoardRow | undefined, ours: boolean): TowerRow['sectors'] {
  return [0, 1, 2].map((i) => {
    const timeMs = row?.newestSectorsMs[i] ?? missing();
    const status = row?.newestSectorStatus[i] ?? 'none';
    const older = timeMs.known && (row?.newestSectorOlder[i] ?? false);
    return { timeMs, status, older, ...(timeMs.known ? { role: sectorRole(status, older, ours) } : {}) };
  });
}

/**
 * The PEN cell from the car's penalties span (race only), else its warnings span. A drive-through or stop-go to serve
 * shows SG while a stop-go is owed, else DT (the user's rule: a stop-go before a drive-through), with the count of that
 * kind when more than one and a time penalty beside it in the title.
 */
function penaltyCell(penalty: OpenSpan | undefined, warnings: OpenSpan | undefined): TowerRow['penalty'] {
  const pen = rowOf(presentation.situations.penalties, penalty)?.pen ?? 'warnings';
  if (pen === 'timePenalty') {
    const { totalMs } = penalty?.detail as TimePenaltyDetail;
    return { text: formatPenaltyMs(totalMs), role: penaltyRole(totalMs, 0) };
  }
  if (pen === 'toServe') {
    const owed = penalty?.detail as PendingPenaltyDetail;
    const shown =
      owed.stopGos > 0 ? { kind: text.unservedPenalty.stopGo, count: owed.stopGos } : { kind: text.unservedPenalty.driveThrough, count: owed.driveThroughs };
    const name = shown.kind.name(shown.count);
    const title = owed.totalMs > 0 ? text.withTimePenalty(name, formatPenaltyMs(owed.totalMs)) : name;
    return { text: shown.kind.code(shown.count), role: penaltyRole(owed.totalMs, shown.count), title };
  }
  const warned = rowOf(presentation.situations.warnings, warnings)?.count === true ? (warnings?.detail as WarnedDetail) : undefined;
  return { text: warned === undefined ? '' : formatWarnings(warned.count) };
}

/**
 * The situation column: a car out of the race shows its status's code; otherwise the row of its activity in the weekend
 * phase's own machine (its own code, the served penalty's, or the location's); without an activity, the location's.
 */
function situationCell(status: StatusRow, activity: OpenSpan | undefined, activityRows: Readonly<Record<string, ActivityRow>> | undefined, location: OpenSpan | undefined): SituationCell {
  if (status.row === 'out') return status.cell;
  const at = rowOf(presentation.situations['car-location'], location) ?? NONE;
  const row = activityRows === undefined ? undefined : rowOf(activityRows, activity);
  if (row === undefined) return at;
  if ('cell' in row) return row.cell;
  if ('byPenalty' in row) return row.byPenalty[(activity?.detail as ServingPenaltyDetail | undefined)?.penalty ?? 'driveThrough'];
  return location === undefined ? NONE : (rowOf(row.byLocation, location) ?? NONE);
}

/** One row per running or retired car: running by position, then retired by car id. A car without a shown status has none. */
export function buildRows(input: TowerInput): TowerRow[] {
  const intervals = new Map(input.intervals.map((i) => [i.carId, i]));
  const toCar = new Map(input.toCar.map((g) => [g.carId, g]));
  const board = new Map(input.board.rows.map((r) => [r.carId, r]));
  const stops = new Map(input.pitStops.byCar.map((s) => [s.carId, s.stops]));
  const incident = momentIncident(input.moment, input.incidents);
  const ours = ourCars(input.session);
  const activityKey = rowOf(presentation.situations['weekend-phase'], openSpanOf(input.phase))?.activity;
  const activities = activityKey === undefined ? undefined : input[activityKey];
  const activityRows = activityKey === undefined ? undefined : ACTIVITY_ROWS[activityKey];

  const rows = input.cars.flatMap((c): TowerRow[] => {
    const id = c.id;
    const status = rowOf(presentation.situations['car-status'], openSpanOf(input.status, id)) ?? HIDDEN;
    if (status.row === 'hidden') return [];
    const gaps = intervals.get(id);
    const lap = board.get(id);
    const retired = status.row === 'out';
    const gained = gaps?.positionsGained;
    const toUs = toCar.get(id);
    return [{
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
      sectors: sectorsOf(lap, ours.has(id)),
      compound: c.tyres.visualCompound,
      age: c.tyres.age,
      stops: stops.get(id),
      penalty: penaltyCell(openSpanOf(input.penalties, id), openSpanOf(input.warnings, id)),
      situation: situationCell(status, openSpanOf(activities, id), activityRows, openSpanOf(input.location, id)),
      overview: c,
    }];
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
