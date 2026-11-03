// The log's vocabulary (contract C21-C27): facts, spans, frame numbers, void and clock facts. Every time is on the race clock (C35).
import type { CarId, SessionTime } from './ids.ts';
import type { Ms } from './units.ts';

/** A sub-machine's folder name under `packages/engine/src/situations/`, kebab-case (C15). */
export type MachineId = string;
/** A span's id: the number of spans its sub-machine opened before it in the projection (per car for a car sub-machine, C26). */
export type SpanId = number;
/**
 * The engine's count of the frames it applied in a session (C26): a new session has applied 0 frames; the first applied
 * frame is number 1. A fact records the frame it describes; a span the frames it opened and closed on. Only the projection
 * computes membership from them, never from times (several frames share one race-clock time).
 */
export type FrameNumber = number;

/** One list of the log (C21): one per fact type and one span list per sub-machine. */
export type FactList = 'laps' | 'stints' | 'pitStops' | 'crossings' | 'events' | 'clock' | 'voids' | `spans:${MachineId}`;
/** A fact's id: its list and its position in the log (C21). */
export type FactRef = { list: FactList; index: number };

/**
 * One situation from its start to its end, closed: a fact of `spans:<machine>` (C9, C18). It covers the frames
 * `startFrame <= f < endFrame` (C26): it opened on `startFrame` and closed on `endFrame`. `joinedAt`: the engine joined
 * the session while it was open.
 */
export type Span<K extends string = string, D = unknown> = {
  machine: MachineId;
  id: SpanId;
  carId?: CarId;
  /** The marshal zone (its index in the Session packet) of a zone sub-machine's span. */
  zone?: number;
  kind: K;
  start: SessionTime;
  end: SessionTime;
  confirmed: boolean;
  joinedAt?: true;
  detail: D;
  startFrame: FrameNumber;
  endFrame: FrameNumber;
};
/** A span still in progress: a sub-machine's open state as readers see it (`view.situation`, C20). */
export type OpenSpan<K extends string = string, D = unknown> = Omit<Span<K, D>, 'end' | 'endFrame'>;

/**
 * The fact a flashback appends (C27): the target, and per list the range `[from, to)` of positions that never happened.
 * `frame`: the frame number of its target, the frame the state was restored to (C26).
 */
export type VoidFact = {
  target: { frameId: number; at: SessionTime };
  ranges: Partial<Record<FactList, readonly [from: number, to: number]>>;
  frame: FrameNumber;
};

/** What the clock sub-machine records (C7, C36): a fall carried over by an offset, a forward jump, the simulated end; `frame`: the frame it describes (C26). */
export type ClockFact =
  | { kind: 'fall'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; offsetMs: Ms; frame: FrameNumber }
  | { kind: 'jump'; at: SessionTime; fromMs: SessionTime; toMs: SessionTime; frame: FrameNumber }
  | { kind: 'simulatedEnd'; at: SessionTime; frame: FrameNumber };

/** A span, open or closed: its sub-machine, its car for a car sub-machine, and its id. */
export type SpanRef = { machine: MachineId; carId?: CarId; zone?: number; spanId: SpanId };
/** What a sub-machine's spans are about (C15). */
export type Scope = 'session' | 'car' | 'zone';

/**
 * A sub-machine's span declaration (C15): its id, its one scope and its span kinds, declared in domain beside its span
 * types so every reader can read them (`scopeOf`). One file `situations/<machine>.ts` each, its named export `spans`.
 */
export type SpanDeclaration<K extends string = string> = { machine: MachineId; scope: Scope; kinds: readonly K[] };
/** A span declaration, its kinds kept as literals. */
export const defineSpans = <const K extends string>(d: SpanDeclaration<K>): SpanDeclaration<K> => d;
