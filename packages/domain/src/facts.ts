// The log's vocabulary (contract C21-C27): facts, spans, stamps, void and clock facts. Every time is on the race clock (C35).
import type { CarId, SessionTime } from './ids.ts';
import type { Ms } from './units.ts';

/** A sub-machine's folder name under `packages/engine/src/situations/`, kebab-case (C15). */
export type MachineId = string;
/** A span's id: the number of spans its sub-machine opened before it in the projection (per car for a car sub-machine, C26). */
export type SpanId = number;
/** The spans open when a fact was recorded (C26): the session-scoped spans and, for a car's fact, that car's spans. Zone spans are never stamped. */
export type Stamp = Readonly<Record<MachineId, SpanId>>;

/** One list of the log (C21): one per fact type and one span list per sub-machine. */
export type FactList = 'laps' | 'stints' | 'pitStops' | 'crossings' | 'events' | 'clock' | 'voids' | `spans:${MachineId}`;
/** A fact's id: its list and its position in the log (C21). */
export type FactRef = { list: FactList; index: number };

/** One situation from its start to its end, closed: a fact of `spans:<machine>` (C9, C18). `joinedAt`: the engine joined the session while it was open. */
export type Span<K extends string = string, D = unknown> = {
  machine: MachineId;
  id: SpanId;
  carId?: CarId;
  kind: K;
  start: SessionTime;
  end: SessionTime;
  confirmed: boolean;
  joinedAt?: true;
  detail: D;
  in: Stamp;
};
/** A span still in progress: a sub-machine's open state as readers see it (`view.situation`, C20). */
export type OpenSpan<K extends string = string, D = unknown> = Omit<Span<K, D>, 'end' | 'in'>;

/** The fact a flashback appends (C27): the target, and per list the range `[from, to)` of positions that never happened. */
export type VoidFact = {
  target: { frameId: number; at: SessionTime };
  ranges: Partial<Record<FactList, readonly [from: number, to: number]>>;
  in: Stamp;
};

/** What the clock sub-machine records (C7, C36): a fall carried over by an offset, a forward jump, the simulated end. */
export type ClockFact =
  | { kind: 'fall'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; offsetMs: Ms; in: Stamp }
  | { kind: 'jump'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; in: Stamp }
  | { kind: 'simulatedEnd'; at: SessionTime; in: Stamp };

/** A span, open or closed: its sub-machine, its car for a car sub-machine, and its id. */
export type SpanRef = { machine: MachineId; carId?: CarId; spanId: SpanId };
/** What a sub-machine's spans are about (C15). */
export type Scope = 'session' | 'car' | 'zone';
