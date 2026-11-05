// Builders shared by the timing-tower gallery and its row tests (test-phase file: the implementer does not edit it).
import type { CarOverview, MachineSpans, PitStopCounts, SessionInfo } from '@pitwall/contracts';
import { feedId, carId, known, toSessionTime, unknown } from '@pitwall/domain';
import type {
  IncidentEntry, CarId, Interval, GapToCar, LapBoard, LapBoardRow, MachineId, Ms, OpenSpan, PendingPenaltyDetail, SectorStatus,
  ServingPenaltyDetail, TimePenaltyDetail, VisualCompound, WarnedDetail, carActivityPracticeSpans, carActivityQualifyingSpans,
  carActivityRaceSpans, carLocationSpans, carStatusSpans,
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
};

/**
 * A `cars.overview` entry; every field not named is quiet. It carries no signal (C13, C54): where the car is, what it
 * does and what it owes come from the situation topics (`situations` below). The casts keep the builder compiling while
 * Task 24 removes the signal fields from `CarIdentity` and `CarTiming`; the tower reads none of them.
 */
export function overview(id: number, o: CarOptions): CarOverview {
  return {
    id: carId(id),
    identity: {
      name: o.name, teamId: 0, raceNumber: id + 1, nationality: 0, driverId: id, networkId: 255, myTeam: false,
      platform: 0, telemetryPublic: true, visibility: o.ours === true ? 'own' : 'public',
    } as CarOverview['identity'],
    timing: {
      position: o.position, lap: o.lap ?? 23, lapDistanceM: 1000, totalDistanceM: 100_000, currentLapTimeMs: 30_000,
      lastLapTimeMs: 105_000, sector: 1, sector1TimeMs: 0, sector2TimeMs: 0, gapToLeaderMs: ms(0),
      gapToCarAheadMs: ms(0), safetyCarDeltaMs: 0, pitLaneTimeMs: 0, pitStopTimerMs: 0,
      gridPosition: o.gridPosition ?? o.position, speedTrapFastestKmh: unknown('notReceived'),
    } as CarOverview['timing'],
    tyres: { actualCompound: 'C3', visualCompound: o.compound ?? 'medium', age: o.age ?? 14 },
    updatedAt: {},
  };
}

/**
 * A `pitStopCount.byCar` value (M7-R, C54): each car's stops by car id, as `pit-stop-count` gives them (ordered by car
 * id). A car left out is one the analysis does not list.
 */
export const pitStopCounts = (stops: Readonly<Record<number, number>>): PitStopCounts => ({
  byCar: Object.entries(stops)
    .map(([id, n]) => ({ carId: carId(Number(id)), stops: n }))
    .sort((a, b) => a.carId - b.carId),
});

/** A `gaps.intervals` entry; times in ms, `undefined` = unknown (the leader has no car ahead). */
// `positionsGained` (gridPosition - position, computed by `gaps`) is a `Known`; `'unknown'` = unknown.
export function interval(id: number, toLeader?: number, toAhead?: number, lapsDown = 0, positionsGained: number | 'unknown' = 0): Interval {
  return {
    carId: carId(id),
    toLeaderMs: toLeader === undefined ? unknown('notApplicable') : ms(toLeader),
    toAheadMs: toAhead === undefined ? unknown('notApplicable') : ms(toAhead),
    toBehindMs: unknown('notApplicable'),
    lapsDown,
    positionsGained: positionsGained === 'unknown' ? unknown('notApplicable') : known(positionsGained, at),
  };
}

/** A `gaps.toCar` entry; positive = behind our car. */
export const toCar = (id: number, gapMs: number | undefined, lapsDown = 0): GapToCar => ({
  carId: carId(id), gapMs: gapMs === undefined ? unknown('notApplicable') : ms(gapMs), lapsDown,
});

/**
 * A lap-board row; `last` is the last lap in ms (`undefined` = not received yet, `'realism'` = withheld, `'retired'` = a
 * car out of the race without a time: its times will not come and the row says it is out, as `lap-times` gives them).
 */
export function boardRow(
  id: number,
  last: number | 'realism' | 'retired' | undefined,
  sectors: [number?, number?, number?] = [],
  status: [SectorStatus, SectorStatus, SectorStatus] = ['none', 'none', 'none'],
  lapStatus: SectorStatus = 'none',
): LapBoardRow {
  const time = (v: number | 'realism' | 'retired' | undefined) =>
    v === 'realism' ? unknown('realism') : v === 'retired' ? unknown('notApplicable') : v === undefined ? unknown('notReceived') : ms(v);
  const s = (v: number | undefined) => (last === 'realism' || last === 'retired' ? time(last) : time(v));
  const unknownDelta = unknown('notApplicable');
  return {
    carId: carId(id),
    lastLapMs: time(last),
    lastSectorsMs: [s(sectors[0]), s(sectors[1]), s(sectors[2])],
    lastSectorStatus: status,
    lastLapStatus: lapStatus,
    bestLapMs: unknown('notReceived'),
    bestSectorsMs: [unknown('notReceived'), unknown('notReceived'), unknown('notReceived')],
    bestLapStatus: 'none',
    bestSectorStatus: ['none', 'none', 'none'],
    theoreticalBestMs: unknown('notReceived'),
    deltaToReference: { bestLapMs: unknownDelta, bestSectorsMs: [unknownDelta, unknownDelta, unknownDelta], theoreticalBestMs: unknownDelta },
    outOfRace: last === 'retired',
  };
}

/** The row of a car the analysis counts out of the race, whatever times it kept (a car that retired after setting laps). */
export const outOfRaceRow = (row: LapBoardRow): LapBoardRow => ({ ...row, outOfRace: true });

/** A lap board with no session bests. */
export const lapBoard = (reference: number, rows: LapBoardRow[]): LapBoard => ({
  referenceCarId: carId(reference) as CarId,
  rows,
  sessionBest: { lap: unknown('notReceived'), sectors: [unknown('notReceived'), unknown('notReceived'), unknown('notReceived')] },
});

/** A `session.info` value: only the cars that are ours matter to the tower. */
export const sessionInfo = (playerCar: number, teammateCar?: number): SessionInfo =>
  ({
    feedId: feedId('gallery'), sessionUid: '1', playerCar: carId(playerCar),
    ...(teammateCar === undefined ? {} : { teammateCar: carId(teammateCar) }),
    realism: false,
  }) as SessionInfo;

/** An `incidents.feed` entry. */
export const incidentEntry = (id: string, severity: 'major' | 'minor', cars: number[]): IncidentEntry => ({
  id, at: toSessionTime(900), lap: 23, kind: 'collision', severity, carIds: cars.map(carId), timeLostMs: unknown('insufficientData'), forUs: [],
  where: { sector: unknown('notReceived') },
});

// ---- Situations (C20, C54): the `situation.<machine>` topics the tower reads, open spans only (`MachineSpans`). ----

type KindOf<D extends { kinds: readonly string[] }> = D['kinds'][number];
export type LocationKind = KindOf<typeof carLocationSpans>;
export type StatusKind = KindOf<typeof carStatusSpans>;
export type RaceActivityKind = KindOf<typeof carActivityRaceSpans>;
export type QualifyingActivityKind = KindOf<typeof carActivityQualifyingSpans>;
export type PracticeActivityKind = KindOf<typeof carActivityPracticeSpans>;
/** The weekend phase's open span; `pending`: none open yet (C14). */
export type PhaseKind = 'race' | 'qualifying' | 'practice' | 'none' | 'pending';

/** One open span of `machine`, of car `car` (a session span without one), as a situation topic carries it. */
export function openSpan(machine: MachineId, kind: string, car?: number, detail?: unknown): OpenSpan {
  return {
    machine, id: 0, kind, start: toSessionTime(500), confirmed: true, detail, startFrame: 1,
    ...(car === undefined ? {} : { carId: carId(car) }),
  };
}

/** A `penalties` span of a car: its kind and detail. */
export type PenaltySpan =
  | { kind: 'clear' }
  | { kind: 'timePenalty'; detail: TimePenaltyDetail }
  | { kind: 'driveThroughPending' | 'stopGoPending'; detail: PendingPenaltyDetail };

/** `timePenalty`: only time penalties stand, `totalMs` in total. */
export const timePenalty = (totalMs: number): PenaltySpan => ({ kind: 'timePenalty', detail: { totalMs, infringement: unknown('notReceived') } });

/** `driveThroughPending` / `stopGoPending`: the kind names the penalty the machine puts first (the oldest unserved); the detail every count. */
export const pendingPenalty = (
  kind: 'driveThroughPending' | 'stopGoPending',
  counts: { driveThroughs?: number; stopGos?: number; totalMs?: number },
): PenaltySpan => ({
  kind,
  detail: { driveThroughs: counts.driveThroughs ?? 0, stopGos: counts.stopGos ?? 0, infringement: unknown('notReceived'), totalMs: counts.totalMs ?? 0 },
});

/** A `servingPenalty` race activity of car `car`: in the pit lane serving a drive-through or a stop-go. */
export const servingPenalty = (car: number, penalty: ServingPenaltyDetail['penalty']): { kind: 'servingPenalty'; detail: ServingPenaltyDetail } => ({
  kind: 'servingPenalty',
  detail: { penalty, given: { machine: 'penalties', carId: carId(car), spanId: 0 } },
});

/**
 * One car's situation; every field left out is quiet: on track, competing, on a racing lap (a push lap in qualifying, a
 * flying lap in practice), owing nothing, no warning. `null`: no open span of that machine for the car.
 */
export type CarSituation = {
  location?: LocationKind | null;
  status?: StatusKind | null;
  /** The car's span of the phase's car-activity machine: a kind, or a kind with its detail. */
  activity?: RaceActivityKind | QualifyingActivityKind | PracticeActivityKind | { kind: string; detail: unknown } | null;
  /** Race only: the `penalties` machine runs in the race alone. */
  penalty?: PenaltySpan | null;
  /** The warnings the car holds: `noWarning` at 0, else `warned` with the count. */
  warnings?: number | null;
};

/** The situation topics of the tower's data, by data key: every machine it reads, open spans only. */
export type TowerSituations = {
  phase: MachineSpans;
  location: MachineSpans;
  status: MachineSpans;
  warnings: MachineSpans;
  raceActivity: MachineSpans | undefined;
  qualifyingActivity: MachineSpans | undefined;
  practiceActivity: MachineSpans | undefined;
  penalties: MachineSpans | undefined;
};

const ACTIVITY = {
  race: { key: 'raceActivity', machine: 'car-activity-race', quiet: 'racingLap' },
  qualifying: { key: 'qualifyingActivity', machine: 'car-activity-qualifying', quiet: 'pushLap' },
  practice: { key: 'practiceActivity', machine: 'car-activity-practice', quiet: 'flyingLap' },
} as const;

const PHASE_DETAIL = {
  race: { format: 'grandPrix' },
  qualifying: { format: 'grandPrix', segment: undefined },
  practice: { format: 'practice', segment: undefined },
  none: undefined,
} as const;

const statusDetail = (kind: StatusKind): unknown => (kind === 'retired' ? { cause: unknown('notReceived') } : undefined);
const kindAndDetail = (v: string | { kind: string; detail: unknown }) => (typeof v === 'string' ? { kind: v, detail: undefined } : v);

/**
 * The situation topics for the cars `ids` in a session of weekend phase `phase` (default race), each car as `of` gives it
 * (quiet when left out). Only the phase's own activity topic has a value, and the penalties topic only in a race: the
 * other per-phase topics are `undefined`, as an optional topic without a value arrives.
 */
export function situations(ids: readonly number[], of: Readonly<Record<number, CarSituation>> = {}, phase: PhaseKind = 'race'): TowerSituations {
  const activity = phase === 'race' || phase === 'qualifying' || phase === 'practice' ? ACTIVITY[phase] : undefined;
  const spansOf = (pick: (car: number, s: CarSituation) => OpenSpan | undefined): MachineSpans => ({
    open: ids.flatMap((id) => pick(id, of[id] ?? {}) ?? []),
  });
  const activitySpans =
    activity === undefined
      ? undefined
      : spansOf((id, s) => {
          if (s.activity === null) return undefined;
          const { kind, detail } = kindAndDetail(s.activity ?? activity.quiet);
          return openSpan(activity.machine, kind, id, detail);
        });
  return {
    phase: { open: phase === 'pending' ? [] : [openSpan('weekend-phase', phase, undefined, PHASE_DETAIL[phase])] },
    location: spansOf((id, s) => (s.location === null ? undefined : openSpan('car-location', s.location ?? 'track', id))),
    status: spansOf((id, s) => (s.status === null ? undefined : openSpan('car-status', s.status ?? 'competing', id, statusDetail(s.status ?? 'competing')))),
    warnings: spansOf((id, s) => {
      if (s.warnings === null) return undefined;
      const count = s.warnings ?? 0;
      const detail: WarnedDetail = { count, cornerCutting: count, infringement: unknown('notReceived') };
      return count === 0 ? openSpan('warnings', 'noWarning', id) : openSpan('warnings', 'warned', id, detail);
    }),
    raceActivity: activity?.key === 'raceActivity' ? activitySpans : undefined,
    qualifyingActivity: activity?.key === 'qualifyingActivity' ? activitySpans : undefined,
    practiceActivity: activity?.key === 'practiceActivity' ? activitySpans : undefined,
    penalties:
      phase === 'race'
        ? spansOf((id, s) => {
            if (s.penalty === null) return undefined;
            const p = s.penalty ?? { kind: 'clear' };
            return openSpan('penalties', p.kind, id, 'detail' in p ? p.detail : undefined);
          })
        : undefined,
  };
}
