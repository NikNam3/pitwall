// The projection (contract C26, C28-C30): the log as readers see it, every hidden fact skipped. The only module that
// computes it, and the only one that computes membership: which spans a fact belongs to, from the frame number it
// describes and the frame numbers each span opened and closed on (`situationAt`, `membershipOf`), never from times. A
// fact is hidden when a void range covers its position (C27) or, for a fact that is neither a span nor a decision, when
// the frame it describes lies in the `formation` span of `session-phase-race` (C29). Spans and decisions are never
// hidden that way.
import { scopeOf, type CarId, type FactList, type FrameNumber, type MachineId, type OpenSpan, type Span, type WeekendPhase } from '@pitwall/domain';
import type { Situation } from '../situations/situation.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { createLog, FACT_LISTS } from './log.ts';
import type { HiddenRanges, HidingFrames, HistoryDelta, Log, LogLengths, LogVoidFact, Projection, ProjectionBook, ProjectionState } from './types.ts';

/** The span that hides the facts describing a frame it covers (C29): what the formation lap recorded did not happen in the race. */
const HIDING = { machine: 'session-phase-race', kind: 'formation' } as const;

/** A span is the hiding one: the race's formation lap. */
const hides = (span: { machine: MachineId; kind: string }): boolean => span.machine === HIDING.machine && span.kind === HIDING.kind;

/** The projection and its bookkeeping, as the engine state holds them (`history`, `open.projection`). */
export type ProjectionHolder = { projection: ProjectionState; book: ProjectionBook };

const emptyBook = (): ProjectionBook => ({ seen: {}, lengths: {}, hidden: { voided: {}, hiding: [] } });

const emptyProjection = (): ProjectionState => ({
  laps: [],
  stints: [],
  pitStops: [],
  crossings: [],
  events: [],
  penalties: [],
  decisions: [],
  clock: [],
  spans: {},
  appendedAt: {},
});

const spanList = (machine: MachineId): FactList => `spans:${machine}`;

/** The length of every list of the projection, keyed like the log's (`spans:<machine>` for the span lists). */
export const projectionLengths = (p: Projection): LogLengths => {
  const lengths: LogLengths = {};
  for (const list of FACT_LISTS) lengths[list] = p[list].length;
  for (const [machine, spans] of Object.entries(p.spans)) lengths[spanList(machine)] = spans.length;
  return lengths;
};

/** A void range covers position `index` of `list` (C27). */
export const isVoided = (list: FactList, index: number, hidden: HiddenRanges): boolean =>
  hidden.voided[list]?.some(([from, to]) => index >= from && index < to) ?? false;

/** The frames a span covers (C26): from the one it opened on up to, not including, the one it closed on; an open span every frame from its first. */
const covers = (span: { startFrame: FrameNumber; endFrame?: FrameNumber }, frame: FrameNumber): boolean =>
  span.startFrame <= frame && (span.endFrame === undefined || frame < span.endFrame);

/** The hiding span as the frames it hides. */
const hidingFramesOf = (span: DeepReadonly<OpenSpan> & { endFrame?: FrameNumber }): HidingFrames => ({
  startFrame: span.startFrame,
  ...(span.endFrame !== undefined && { endFrame: span.endFrame }),
});

/**
 * A fact of `list` is hidden by formation (C29): it is neither a span nor a decision and the frame it describes lies in
 * the race's formation span, whenever the fact was recorded.
 */
export const isHidden = (fact: { frame: FrameNumber }, list: FactList, hidden: HiddenRanges): boolean => {
  if (list.startsWith('spans:') || list === 'decisions') return false;
  return hidden.hiding.some((h) => covers(h, fact.frame));
};

/** The void ranges of every void fact, each range once. */
const voidedBy = (voids: readonly DeepReadonly<LogVoidFact>[]): HiddenRanges['voided'] => {
  const voided: HiddenRanges['voided'] = {};
  for (const v of voids) {
    for (const [list, range] of Object.entries(v.ranges) as Array<[FactList, readonly [number, number]]>) {
      const ranges = (voided[list] ??= []);
      if (!ranges.some(([from, to]) => from === range[0] && to === range[1])) ranges.push([range[0], range[1]]);
    }
  }
  return voided;
};

/** The hidden ranges with the open hiding span added: a fact can describe a frame of a span still open. */
const withOpen = (hidden: HiddenRanges, open: Situation): HiddenRanges => {
  const hiding = (open.byMachine[HIDING.machine] ?? []).filter(hides);
  if (hiding.length === 0) return hidden;
  return { voided: hidden.voided, hiding: [...hidden.hiding, ...hiding.map(hidingFramesOf)] };
};

/**
 * `current` extended by the visible facts of `source` from position `from`. While nothing of a list is hidden the
 * projected list is the log's own array (appends extend it at once, nothing is copied); the first hidden fact turns it
 * into a copy of the visible facts. An empty list not yet projected starts as the log's array.
 */
function project<T>(current: T[] | undefined, source: T[], from: number, visible: (index: number) => boolean): T[] {
  let out = current ?? [];
  let shared = out === source || (from === 0 && out.length === 0);
  for (let i = from; i < source.length; i++) {
    if (visible(i)) {
      if (!shared) out.push(source[i] as T);
    } else if (shared) {
      out = source.slice(0, i);
      shared = false;
    }
  }
  return shared ? source : out;
}

/** The append frame of every entry of `p`, by identity (a log entry is one object, in the log and the projection alike). */
const appendFramesByEntry = (p: ProjectionState): Map<unknown, FrameNumber> => {
  const frames = new Map<unknown, FrameNumber>();
  const add = (list: string, entries: readonly unknown[]) => {
    const at = p.appendedAt[list];
    if (at === undefined) return;
    entries.forEach((entry, i) => {
      const frame = at[i];
      if (frame !== undefined) frames.set(entry, frame);
    });
  };
  for (const list of FACT_LISTS) add(list, p[list]);
  for (const [machine, spans] of Object.entries(p.spans)) add(spanList(machine), spans);
  return frames;
};

/**
 * Keeps the projection of one log (C28). Incremental: appends extend the projected lists; a new void fact rebuilds the
 * projection once and reports its target as `rewound` (C30). Writes only the projection and its book, never the log.
 */
export class ProjectionTracker {
  // Typed writable because a projected list can be the log's own array; the tracker never writes through it.
  readonly #log: Log;
  readonly #projection: ProjectionState;
  readonly #book: ProjectionBook;
  /** The frame the running update appends on (`update`'s `frame`); `undefined`: no append frames are kept. */
  #frame: FrameNumber | undefined;
  /** During a rebuild: the append frame of every entry the projection held before it, by identity. */
  #before: Map<unknown, FrameNumber> | undefined;

  constructor(log: DeepReadonly<Log>, holder: ProjectionHolder = { projection: emptyProjection(), book: emptyBook() }) {
    this.#log = log as Log;
    this.#projection = holder.projection;
    this.#book = holder.book;
  }

  get projection(): Projection {
    return this.#projection;
  }

  /**
   * Projects what the log gained since the last update; `open`: the open spans, whose frames can hide facts too;
   * `frame`: the frame number the update appends on, kept per entry (`appendedAt`, for `projectionAsOf`). Without it
   * (a stored session's complete log) no append frames are kept.
   */
  update(open: Situation, frame?: FrameNumber): HistoryDelta {
    const before = this.#book.lengths;
    const fresh = this.#log.voids.slice(this.#book.seen.voids ?? 0);
    this.#frame = frame;
    if (fresh.length > 0) this.#rebuild(open);
    else this.#extend(open);
    this.#frame = undefined;
    const after = projectionLengths(this.#projection);
    this.#book.lengths = after;
    const target = fresh.at(-1)?.target;
    return { before, after, ...(target && { rewound: { frameId: target.frameId, at: target.at } }) };
  }

  #rebuild(open: Situation): void {
    const p = this.#projection;
    // An entry that stays visible keeps the frame it was appended on: a run without the undone frames appended it then (C33).
    this.#before = appendFramesByEntry(p);
    for (const list of FACT_LISTS) p[list] = [];
    p.spans = {};
    p.appendedAt = {};
    this.#book.seen = {};
    this.#book.hidden = { voided: voidedBy(this.#log.voids), hiding: [] };
    this.#extend(open);
    this.#before = undefined;
  }

  /** Keeps `list`'s append frames in step with its projected entries: an entry new to it was appended on this update's frame. */
  #stamp(list: string, projected: readonly unknown[]): void {
    const frame = this.#frame;
    if (frame === undefined) return;
    // An empty list keeps no append frames, as in a run that never appended to it; a list empties only in a rebuild,
    // which starts the append frames over.
    if (projected.length === 0) return;
    const at = this.#projection.appendedAt;
    const frames = at[list] ?? [];
    while (frames.length < projected.length) frames.push(this.#before?.get(projected[frames.length]) ?? frame);
    at[list] = frames;
  }

  #extend(open: Situation): void {
    const log = this.#log;
    const p = this.#projection;
    const { seen, hidden } = this.#book;
    // Spans first: a closed hiding span hides the facts describing a frame it covers, also those of this update.
    for (const [machine, spans] of Object.entries(log.spans)) {
      const list = spanList(machine);
      const from = seen[list] ?? 0;
      for (let i = from; i < spans.length; i++) {
        const s = spans[i] as Span;
        if (hides(s) && !isVoided(list, i, hidden)) hidden.hiding.push(hidingFramesOf(s));
      }
      const projected = project(p.spans[machine], spans, from, (i) => !isVoided(list, i, hidden));
      // A machine none of whose spans is visible (each voided) has no list, as in a run that never closed one (C33).
      if (projected.length > 0) p.spans[machine] = projected;
      else if (machine in p.spans) p.spans = Object.fromEntries(Object.entries(p.spans).filter(([m]) => m !== machine));
      this.#stamp(list, projected);
      seen[list] = spans.length;
    }
    const hiding = withOpen(hidden, open);
    for (const list of FACT_LISTS) this.#projectList(list, hiding);
    seen.voids = log.voids.length;
  }

  #projectList<L extends (typeof FACT_LISTS)[number]>(list: L, hiding: HiddenRanges): void {
    const source = this.#log[list] as Array<{ frame: FrameNumber }>;
    const current = this.#projection[list] as Array<{ frame: FrameNumber }>;
    const from = this.#book.seen[list] ?? 0;
    const visible = (i: number) => !isVoided(list, i, hiding) && !isHidden(source[i] as { frame: FrameNumber }, list, hiding);
    const projected = project(current, source, from, visible);
    (this.#projection[list] as unknown[]) = projected;
    this.#stamp(list, projected);
    this.#book.seen[list] = source.length;
  }
}

/** A new session's log and its projection (both empty, the projected lists the log's own arrays). */
export const newHistory = (open: Situation): { log: Log } & ProjectionHolder => {
  const log = createLog();
  const holder: ProjectionHolder = { projection: emptyProjection(), book: emptyBook() };
  new ProjectionTracker(log, holder).update(open);
  return { log, ...holder };
};

/**
 * Where a reader finds spans (C20): the projection's closed spans and, for a running session, the open ones of the
 * situation. The view satisfies it; a stored or weekend projection passes `history` only (all its spans are closed).
 */
export type MembershipSource = { history: DeepReadonly<Projection>; situation?: Situation };

/**
 * Every visible span covering `frame` (C26): the closed ones of `source.history.spans` (`startFrame <= frame <
 * endFrame`) and the open ones of `source.situation` (`startFrame <= frame`), the clock's included, by machine. A
 * machine with no span covering the frame is absent.
 */
export function situationAt(source: MembershipSource, frame: FrameNumber): Readonly<Record<MachineId, readonly DeepReadonly<OpenSpan>[]>> {
  const at: Record<MachineId, DeepReadonly<OpenSpan>[]> = {};
  const add = (machine: MachineId, spans: readonly DeepReadonly<OpenSpan & { endFrame?: FrameNumber }>[]) => {
    const covering = spans.filter((s) => covers(s, frame));
    if (covering.length > 0) (at[machine] ??= []).push(...covering);
  };
  for (const [machine, spans] of Object.entries(source.history.spans)) add(machine, spans);
  for (const [machine, spans] of Object.entries(source.situation?.byMachine ?? {})) add(machine, spans);
  return at;
}

/**
 * The spans a fact belongs to (C26), from the frame it describes: of `situationAt(source, fact.frame)`, the spans of
 * session-scoped machines (the clock's included) and, for a car's fact, its car's spans of car-scoped machines. Each
 * machine's scope is its span declaration's in domain (`scopeOf`, C15); a machine without one, and zone spans, never
 * belong to a fact.
 */
export function membershipOf(source: MembershipSource, fact: { frame: FrameNumber; carId?: CarId }): Readonly<Record<MachineId, DeepReadonly<OpenSpan>>> {
  const member: Record<MachineId, DeepReadonly<OpenSpan>> = {};
  for (const [machine, spans] of Object.entries(situationAt(source, fact.frame))) {
    const scope = scopeOf(machine);
    const span = scope === 'session' ? spans[0] : scope === 'car' && fact.carId !== undefined ? spans.find((s) => s.carId === fact.carId) : undefined;
    if (span) member[machine] = span;
  }
  return member;
}

/**
 * The projection as it stood after frame N: per list the entries appended on frames up to N (the book's append frames,
 * `ProjectionState.appendedAt`, SP4.3a plan review P1), never a fact appended later about an earlier frame (a confirmed
 * lap, C25); and the situation at N: the spans open at N, a span closed after N among them without its end.
 */
export function projectionAsOf(source: MembershipSource, frame: FrameNumber): { history: Projection; situation: Situation } {
  const h = source.history;
  const appendedAt: Record<string, FrameNumber[]> = {};
  /** The first entries of `list`, those appended by `frame`, with their append frames. */
  const cut = <T>(list: string, entries: readonly T[]): T[] => {
    const n = appendedBy(list, entries.length, h.appendedAt, frame);
    if (n > 0) appendedAt[list] = (h.appendedAt[list] as readonly FrameNumber[]).slice(0, n);
    return entries.slice(0, n);
  };
  const lists = Object.fromEntries(FACT_LISTS.map((list) => [list, cut(list, h[list] as readonly unknown[])]));

  // The running session's machines keep their keys, as `situationOf` gives them; an open span that opened by N is open at N.
  const byMachine: Record<MachineId, DeepReadonly<OpenSpan>[]> = {};
  for (const [machine, open] of Object.entries(source.situation?.byMachine ?? {})) byMachine[machine] = open.filter((s) => s.startFrame <= frame);
  const spans: Record<MachineId, DeepReadonly<Span>[]> = {};
  for (const [machine, closed] of Object.entries(h.spans)) {
    const kept = cut(spanList(machine), closed);
    if (kept.length > 0) spans[machine] = kept;
    // Closed after N, opened by N: open at N, as it stood then.
    const later = closed.slice(kept.length).filter((s) => s.startFrame <= frame);
    if (later.length > 0) byMachine[machine] = [...later.map(asOpen), ...(byMachine[machine] ?? [])];
  }
  const history = { ...lists, spans, appendedAt } as unknown as Projection;
  return { history, situation: { weekendPhase: phaseAt(byMachine[WEEKEND_PHASE]?.[0]), byMachine } };
}

/** How many of a list's `length` entries were appended on frames up to `frame` (append frames never decrease). */
const appendedBy = (list: string, length: number, appendedAt: Projection['appendedAt'], frame: FrameNumber): number => {
  if (length === 0) return 0;
  const frames = appendedAt[list];
  // A bug of the caller (C3): a stored projection keeps no append frames and supports only frame 'now'.
  if (frames === undefined || frames.length !== length) throw new Error(`projectionAsOf: no append frames for ${list}`);
  let n = 0;
  while (n < length && (frames[n] as FrameNumber) <= frame) n++;
  return n;
};

/** A closed span as it stood open: without the end and the frame it closed on. */
const asOpen = (span: DeepReadonly<Span>): DeepReadonly<OpenSpan> => {
  const { end: _end, endFrame: _endFrame, ...open } = span;
  return open;
};

/** The weekend-phase sub-machine, whose open span is the weekend phase (C14). */
const WEEKEND_PHASE: MachineId = 'weekend-phase';

/**
 * The weekend phase at N (C14): the weekend-phase span open at N, its kind and detail as domain declares them; pending
 * while none is open. Read from the span, not from the sub-machine's code, which the projection never loads (C28).
 */
const phaseAt = (span: DeepReadonly<OpenSpan> | undefined): WeekendPhase =>
  span === undefined ? { kind: 'pending' } : ({ kind: span.kind, ...(span.detail as object) } as WeekendPhase);
