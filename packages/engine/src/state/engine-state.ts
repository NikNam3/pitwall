import type {
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
 * Work in progress behind the history. Per-car arrays are indexed by `CarId` and have `MAX_CARS` entries.
 * Plain data only, so `structuredClone` can snapshot it.
 */
export type OpenTrackers = {
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
