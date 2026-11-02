import type {
  OpenSessionPhase,
  SessionPhaseSpan,
  ActualCompound,
  CarId,
  CarState,
  FeedId,
  FlagPhase,
  Kg,
  Known,
  LapRecord,
  Metres,
  Ms,
  PitStatus,
  SessionFlag,
  SessionState,
  SessionTime,
  SessionUid,
  VisualCompound,
} from '@pitwall/domain';
import type { ProjectionBook } from '../log/projection.ts';
import type { Log, ProjectionState } from '../log/types.ts';
import type { WeekendContext } from './weekend-context.ts';

/**
 * The lengths of the log's lists that the situation tracker notes (the formation's and the start's first entries) to cut
 * back or re-stamp them; goes with those mechanisms (Tasks 7, 9).
 */
export type TrackerLengths = Record<'laps' | 'stints' | 'pitStops' | 'crossings' | 'events' | 'flagPhases' | 'sessionPhases' | 'pauses', number>;

/** The lap a car is on, collected until the lap completes and becomes a `LapRecord`. */
export type LapCursor = {
  lap: number;
  startedAt: SessionTime;
  fuelAtStartKg: Known<Kg>;
  tyreAgeAtStart: number;
  scMs: Ms;
  vscMs: Ms;
  /** The car entered the pits on this lap (in-lap). */
  pitted: boolean;
  sector1Ms: Ms;
  sector2Ms: Ms;
  invalid: boolean;
  lastSeenAt: SessionTime;
  trackedMs: Ms;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  outLap: boolean;
  /** The engine saw the lap from its start; false when it joined the car mid-lap, so ranges and fuel at start would cover part of it only. */
  fromStart: boolean;
  /** The car's lap distance on the lap's newest LapData frame; negative before the line (an out lap from the garage). */
  lapDistanceM: Metres;
  /** The lap timer on the lap's newest LapData frame; a drop tells the line after an out lap on the same lap number. */
  lapTimeMs: Ms;
  /** Wear and ERS store from the frame that starts the lap; `unknown('notReceived')` when the engine joined the lap after its start. */
  wearAtStartPct: LapRecord['wearAtStartPct'];
  ersStoreAtStartJ: LapRecord['ersStoreAtStartJ'];
  /** Per band channel (the order of `CHANNELS` in `history/lap-samples.ts`): lowest and highest value of the lap's frames; min above max = none seen. */
  channelMin: number[];
  channelMax: number[];
  /** The last in-lap ERS totals (the game resets them at the line); `undefined` = none seen. */
  ersDeployedJ: number | undefined;
  ersHarvestedJ: number | undefined;
};

/** The stint a car is on, until it becomes a `StintRecord`. */
export type OpenStint = {
  firstLap: number;
  actualCompound: ActualCompound;
  visualCompound: VisualCompound;
  tyreAgeAtFitting: number;
  lastAge: number;
};

/** A pit visit in progress, until it becomes a `PitStopRecord`. */
export type OpenPitVisit = {
  lap: number;
  entry: SessionTime;
  flag: 'green' | 'sc' | 'vsc';
  penaltyServed: boolean;
  pitLaneTimeMs: Ms;
  stationaryTimeMs: Ms;
};

/**
 * The situation tracker's bookkeeping behind `OpenTrackers.situations` (`history/situations/`, spec 3.1-3.3): what a
 * later frame needs to confirm, discard or re-stamp what an earlier one recorded.
 */
export type PhaseBook = {
  /** A frame was applied, so the next one is not the session's first (where the tracker joins the session). */
  started: boolean;
  /**
   * A neutralisation opened on its SCAR deployment and not yet confirmed by the safety car status: the span it closed
   * (recorded on confirmation; its end is the deployment's time) and the phase it replaced (back in place when it is
   * dropped).
   */
  unconfirmed?: { closed: SessionPhaseSpan; replaced: OpenSessionPhase } | undefined;
  /** The history lengths when the formation phase opened: lights out cuts the history back to them (spec 3.2). */
  formationFrom?: TrackerLengths | undefined;
  /** The history lengths when the race's start lights began (not a restart's): where the start's entries begin. */
  startFrom?: TrackerLengths | undefined;
  /**
   * The race's lights out: its frame id (the start settles within a window after it) and the start's entries that the
   * settling re-stamps: history from `from`, phases from index `phaseFrom` (the start lights) on (spec 3.3).
   */
  lightsOut?: { frameId: number; from: TrackerLengths; phaseFrom: number } | undefined;
  /**
   * How far the race clock runs ahead of the game's session time: the sum of the unexplained falls since the race start
   * (spec 3.3, user ruling 2026-10-30). Every frame is stamped at its session time plus this, so the race clock never
   * falls but at a flashback or the start's own rules.
   */
  clockOffsetMs: Ms;
  /**
   * The receive time of the previous frame (wall clock, ms), for offline pauses and the post-session jump; unset only
   * before the session's first frame.
   */
  lastWallMs?: number | undefined;
  /**
   * Set by a rewind whose frame still carried the pre-rewind session time (inventory 1.10): the game's session time
   * (not the race clock) the frames right after the rewind carry while they still belong to its target moment.
   */
  staleRawMs?: SessionTime | undefined;
  /** An online pause (`gamePaused`) in progress: its session time and receive time. */
  onlinePause?: { start: SessionTime; wallMs: number } | undefined;
};

/**
 * Work in progress behind the history. Per-car arrays are indexed by `CarId` and have `MAX_CARS` entries.
 * Plain data only, so `structuredClone` can snapshot it.
 */
export type OpenTrackers = {
  /** The situation tracker's open state (`history/situations/`): the phase in progress (paused: `phaseBook.onlinePause`). */
  situations: { session: OpenSessionPhase };
  phaseBook: PhaseBook;
  laps: Array<LapCursor | undefined>;
  stints: Array<OpenStint | undefined>;
  pitVisits: Array<OpenPitVisit | undefined>;
  flagPhase?: Omit<FlagPhase, 'end' | 'endLeaderLap'> | undefined;
  /** `session.flag` after the previous frame. */
  lastFlag: SessionFlag;
  miniSectors: Array<
    | {
        lap: number;
        /** The last segment emitted in that lap; -1 = none. */
        segment: number;
        distanceM: Metres;
        at: SessionTime;
      }
    | undefined
  >;
  /** Per car: lap number to the index of its provisional record in `log.laps`, and whether it is confirmed. */
  lapIndex: Array<Record<number, { provisional?: number; confirmed: boolean }>>;
  /** Per car: the pit status of the previous frame. */
  pitStatus: Array<PitStatus | undefined>;
  /** Per car: the eight damage percentages of the previous reading (order of `PARTS` in damage-changes.ts); for `damageChange` events. */
  damage: Array<number[] | undefined>;
  /** The projection's bookkeeping (`log/projection.ts`): what of the log it has projected and what hides facts. */
  projection: ProjectionBook;
};

/** The engine's whole model of one session (spec 6.1). `cars` is indexed by `CarId`. */
export type EngineState = {
  feedId: FeedId;
  sessionUid: SessionUid;
  session: SessionState;
  cars: CarState[];
  /** The append-only log (C21): read only by the projection, the runner and the storage writer (C28). */
  log: Log;
  /** The projection of the log (C28): what readers see as the history. */
  history: ProjectionState;
  playerCar: CarId;
  teammateCar?: CarId | undefined;
  lastFrameId: number;
  /** The last frame's time on the race clock: its session time plus `open.phaseBook.clockOffsetMs`. */
  sessionTime: SessionTime;
  open: OpenTrackers;
  weekend?: WeekendContext | undefined;
  /** Realism mode (spec 7.9): rival cars' hidden fields stay `unknown('realism')`. Fixed for the session. */
  realism: boolean;
};
