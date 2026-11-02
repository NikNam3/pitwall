// The log and the projection (contract C21-C30): one list per fact type and one span list per sub-machine.
import type {
  ClockFact,
  FactList,
  FactRef,
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
              ? VoidFact
              : Span;

/** The length of every list that has facts. */
export type LogLengths = Partial<Record<FactList, number>>;
/** What a frame changed in the log (C30): the lengths before and after; `rewound` when a void fact appeared. */
export type HistoryDelta = { before: LogLengths; after: LogLengths; rewound?: VoidFact['target'] };

/** The writable log (C22): only the machine, the recorders and the runner receive one. Append-only (C24). */
export interface LogWriter {
  append<L extends FactList>(list: L, fact: FactOf<L>): FactRef;
  lengths(): LogLengths;
}

/** The log as readers see it (C28): every hidden fact skipped. */
export type Projection = DeepReadonly<{
  laps: LapRecord[];
  stints: StintRecord[];
  pitStops: PitStopRecord[];
  crossings: MiniSectorCrossing[];
  events: RaceEvent[];
  clock: ClockFact[];
  spans: Record<MachineId, Span[]>;
}>;
