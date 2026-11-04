// The log and the projection (contract C21-C30): one list per fact type and one span list per sub-machine.
import type {
  ClockFact,
  FactList,
  FactRef,
  FrameNumber,
  LapRecord,
  MachineId,
  MiniSectorCrossing,
  PitStopRecord,
  RaceEvent,
  Span,
  StintRecord,
  VoidFact,
} from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';

/** The fact type of a list. */
export type FactOf<L extends FactList> = L extends 'laps'
  ? LapRecord
  : L extends 'stints'
    ? StintRecord
    : L extends 'pitStops'
      ? PitStopRecord
      : L extends 'crossings'
        ? MiniSectorCrossing
        : L extends 'events'
          ? RaceEvent
          : L extends 'clock'
            ? ClockFact
            : L extends 'voids'
              ? LogVoidFact
              : Span;

/** A void fact as the log stores it (C27). */
export type LogVoidFact = VoidFact;

/** The length of every list that has facts. */
export type LogLengths = Partial<Record<FactList, number>>;
/** What a frame changed in the log (C30): the lengths before and after; `rewound` when a void fact appeared. */
export type HistoryDelta = { before: LogLengths; after: LogLengths; rewound?: VoidFact['target'] };

/** The writable log (C22): only the machine, the recorders and the runner receive one. Append-only (C24). */
export interface LogWriter {
  append<L extends FactList>(list: L, fact: FactOf<L>): FactRef;
  lengths(): LogLengths;
}

/** The lists of the log as readers see them; `spans` holds `spans:<machine>` by machine. */
type Lists = {
  laps: LapRecord[];
  stints: StintRecord[];
  pitStops: PitStopRecord[];
  crossings: MiniSectorCrossing[];
  events: RaceEvent[];
  clock: ClockFact[];
  spans: Record<MachineId, Span[]>;
};

/**
 * The append-only log (C21): one list per fact type, the void facts and one span list per sub-machine. Plain data (snapshots copy it). Written through a `LogWriter` (`log/log.ts`); read only by the projection,
 * the runner and the storage writer (C28).
 */
export type Log = Lists & { voids: LogVoidFact[] };

/** The projection as the engine keeps it (`EngineState.history`): written only by `log/projection.ts`. */
export type ProjectionState = Lists;

/** The log as readers see it (C28): every hidden fact skipped. */
export type Projection = DeepReadonly<ProjectionState>;

/** A list of the projection that holds records (every key but `spans`). */
export type ProjectedList = Exclude<keyof ProjectionState, 'spans'>;

/**
 * A hiding span (the race's `formation`, C29) as the frames it covers (C26): `startFrame <= f < endFrame`, every frame
 * from `startFrame` while it is open (no `endFrame`).
 */
export type HidingFrames = { startFrame: FrameNumber; endFrame?: FrameNumber };

/**
 * What hides facts: per list the void ranges `[from, to)` of log positions (C27, from the void facts), and the frames
 * of the closed hiding spans (the open one comes with each update's situation).
 */
export type HiddenRanges = {
  voided: Partial<Record<FactList, Array<readonly [from: number, to: number]>>>;
  hiding: HidingFrames[];
};

/** The projection's bookkeeping (`log/projection.ts`), kept in the engine state (`open.projection`) so snapshots carry it. Plain data. */
export type ProjectionBook = {
  /** The log's lengths projected so far. */
  seen: LogLengths;
  /** The projection's lengths after the last update: the next update's `before`. */
  lengths: LogLengths;
  hidden: HiddenRanges;
};
