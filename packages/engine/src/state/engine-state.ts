import type {
  OpenSessionPhase,
  PauseSpan,
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
  MiniSectorCrossing,
  Ms,
  PitStatus,
  PitStopRecord,
  RaceEvent,
  SessionFlag,
  SessionState,
  SessionTime,
  SessionUid,
  StintRecord,
  VisualCompound,
} from '@pitwall/domain';
import type { WeekendContext } from './weekend-context.ts';

/** Append-only (spec 6.3). */
export type History = {
  /**
   * Every lap record ever emitted, so one (car, lap) can appear twice (provisional, then confirmed).
   * Read it through `currentLaps` / `addLaps` from `@pitwall/domain`, not directly.
   */
  laps: LapRecord[];
  stints: StintRecord[];
  pitStops: PitStopRecord[];
  flagPhases: FlagPhase[];
  /** Closed session phases, oldest first (spec 3.1); the phase in progress is `open.situations.session`. */
  sessionPhases: SessionPhaseSpan[];
  /** Pauses, oldest first (display only). */
  pauses: PauseSpan[];
  events: RaceEvent[];
  miniSectors: MiniSectorCrossing[];
};

export type HistoryLengths = { [K in keyof History]: number };

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
   * (recorded on confirmation) and the phase it replaced (back in place when it is dropped), and how many later Session
   * packets did not confirm it.
   */
  unconfirmed?: { closed: SessionPhaseSpan; replaced: OpenSessionPhase; sessionPackets: number } | undefined;
  /** The history lengths when the formation phase opened: lights out cuts the history back to them (spec 3.2). */
  formationFrom?: HistoryLengths | undefined;
  /** The history lengths when the race's start lights began (not a restart's): where the start's entries begin. */
  startFrom?: HistoryLengths | undefined;
  /**
   * The race's lights out: its frame id (the start settles within a window after it) and the start's entries that the
   * settling re-stamps: history from `from`, phases from index `phaseFrom` (the start lights) on (spec 3.3).
   */
  lightsOut?: { frameId: number; from: HistoryLengths; phaseFrom: number } | undefined;
  /** The receive time of the previous frame (wall clock, ms), for offline pauses. */
  lastWallMs?: number | undefined;
  /** An online pause (`gamePaused`) in progress: its session time and receive time. */
  onlinePause?: { start: SessionTime; wallMs: number } | undefined;
};

/**
 * Work in progress behind the history. Per-car arrays are indexed by `CarId` and have `MAX_CARS` entries.
 * Plain data only, so `structuredClone` can snapshot it.
 */
export type OpenTrackers = {
  /** The situation tracker's open state (`history/situations/`): the phase in progress and whether the session is paused. */
  situations: { session: OpenSessionPhase; paused: boolean };
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
  /** Per car: lap number to the index of its provisional record in `history.laps`, and whether it is confirmed. */
  lapIndex: Array<Record<number, { provisional?: number; confirmed: boolean }>>;
  /** Per car: the pit status of the previous frame. */
  pitStatus: Array<PitStatus | undefined>;
  /** Per car: the eight damage percentages of the previous reading (order of `PARTS` in damage-changes.ts); for `damageChange` events. */
  damage: Array<number[] | undefined>;
};

/** The engine's whole model of one session (spec 6.1). `cars` is indexed by `CarId`. */
export type EngineState = {
  feedId: FeedId;
  sessionUid: SessionUid;
  session: SessionState;
  cars: CarState[];
  history: History;
  playerCar: CarId;
  teammateCar?: CarId | undefined;
  lastFrameId: number;
  sessionTime: SessionTime;
  open: OpenTrackers;
  weekend?: WeekendContext | undefined;
  /** Realism mode (spec 7.9): rival cars' hidden fields stay `unknown('realism')`. Fixed for the session. */
  realism: boolean;
};
