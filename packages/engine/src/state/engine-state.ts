import type {
  OpenSessionPhase,
  SessionPhaseSpan,
  CarId,
  CarState,
  FeedId,
  FlagPhase,
  FrameEvent,
  MachineId,
  SessionFlag,
  SessionState,
  SessionTime,
  SessionUid,
} from '@pitwall/domain';
import type { ProjectionBook } from '../log/projection.ts';
import type { Log, ProjectionState } from '../log/types.ts';
import type { Signals } from '../signals/types.ts';
import type { ClockOpen } from '../situations/clock/types.ts';
import type { WeekendContext } from './weekend-context.ts';

/**
 * The lengths of the log's lists that the situation tracker notes (the formation's and the start's first entries) to cut
 * them back; goes with that mechanism (Task 9).
 */
export type TrackerLengths = Record<'laps' | 'stints' | 'pitStops' | 'crossings' | 'events' | 'flagPhases' | 'sessionPhases', number>;

/**
 * The situation tracker's bookkeeping behind `OpenTrackers.situations` (`history/situations/`, spec 3.1, 3.2): what a
 * later frame needs to confirm or discard what an earlier one recorded. The clock's fields moved to `open.clock` (Task 7);
 * Task 9 deletes the rest.
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
};

/**
 * Work in progress behind the history. Per-car arrays are indexed by `CarId` and have `MAX_CARS` entries.
 * Plain data only, so `structuredClone` can snapshot it.
 */
export type OpenTrackers = {
  /** The situation tracker's open state (`history/situations/`): the phase in progress. */
  situations: { session: OpenSessionPhase };
  phaseBook: PhaseBook;
  /** Step 0's open state (`situations/clock/`, C7): the race clock's offset, the last receive time, a pause in progress. */
  clock: ClockOpen;
  /** The flag phase in progress (`history/flags.ts`, the tracker's mirror until Task 19). */
  flagPhase?: Omit<FlagPhase, 'end' | 'endLeaderLap'> | undefined;
  /** `session.flag` after the previous frame. */
  lastFlag: SessionFlag;
  /** Each recorder's own open state by recorder id (C10, C11): only that recorder reads it. */
  recorders: Record<string, unknown>;
  /** Each sub-machine's open state by machine id (C9); empty until the machine runs (Task 5). */
  machines: Record<MachineId, unknown>;
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
  /** This frame's signals (C12, C13): written by step 1, read only by the machine; never part of the live state or the view. */
  signals: Signals;
  /** This frame's value events (OVTK, COLL, FTLP, SPTP), written by step 1 (C8). */
  frameEvents: FrameEvent[];
  playerCar: CarId;
  teammateCar?: CarId | undefined;
  lastFrameId: number;
  /** The last frame's time on the race clock: its session time plus `open.clock.offsetMs`. */
  sessionTime: SessionTime;
  open: OpenTrackers;
  weekend?: WeekendContext | undefined;
  /** Realism mode (spec 7.9): rival cars' hidden fields stay `unknown('realism')`. Fixed for the session. */
  realism: boolean;
  /**
   * Whom realism masks on this frame: the player, the teammate and realism as the previous frame left them. `step` sets
   * it before step 1, and the step-1 modules read only this, never `playerCar`/`teammateCar`, which the identity module
   * changes during the frame (C11). A player change shows in the masking one frame later.
   */
  masking: Readonly<{ player: CarId; teammate: CarId | undefined; realism: boolean }>;
};
