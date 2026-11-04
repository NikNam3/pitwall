import type {
  CarId,
  CarState,
  FeedId,
  FrameEvent,
  FrameNumber,
  MachineId,
  SessionState,
  SessionTime,
  SessionUid,
} from '@pitwall/domain';
import type { Log, ProjectionBook, ProjectionState } from '../log/types.ts';
import type { Signals } from '../signals/types.ts';
import type { ClockOpen } from '../situations/clock/types.ts';
import type { WeekendContext } from './weekend-context.ts';

/**
 * Work in progress behind the history. Per-car arrays are indexed by `CarId` and have `MAX_CARS` entries.
 * Plain data only, so `structuredClone` can snapshot it.
 */
export type OpenTrackers = {
  /** Step 0's open state (`situations/clock/`, C7): the race clock's offset, the last receive time, the open span (`running` or `paused`). */
  clock: ClockOpen;
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
  /**
   * The frames applied in the session (C26): 0 in a new session's state; `step` counts each frame first, so while frame N
   * is applied every step sees N. Snapshots carry it and a rewind restores it, so the replayed and later frames get the
   * numbers a run without the undone frames gives them (C27, C33). Nothing else writes it.
   */
  frameNumber: FrameNumber;
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
