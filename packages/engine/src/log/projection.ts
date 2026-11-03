// The projection (contract C26, C28-C30): the log as readers see it, every hidden fact skipped. The only module that
// computes it, and the only one that computes membership: which spans a fact belongs to, from the frame number it
// describes and the frame numbers each span opened and closed on (`situationAt`, `membershipOf`), never from times. A
// fact is hidden when a void range covers its position (C27) or, for a fact that is no span, when the frame it describes
// lies in a span of a hiding kind (`formation`, C29): the session's, or its own car's. Spans are never hidden that way.
import { scopeOf, type CarId, type FactList, type FrameNumber, type MachineId, type OpenSpan, type Span } from '@pitwall/domain';
import type { Situation } from '../situations/situation.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { createLog, FACT_LISTS, LEGACY_LISTS } from './log.ts';
import type { HiddenRanges, HidingFrames, HistoryDelta, LegacyList, Log, LogLengths, LogVoidFact, Projection, ProjectionBook, ProjectionState } from './types.ts';

/** The span kind that hides the facts describing a frame it covers (C29): what the formation lap recorded did not happen in the race. */
const HIDING_KIND = 'formation';

/** The projection and its bookkeeping, as the engine state holds them (`history`, `open.projection`). */
export type ProjectionHolder = { projection: ProjectionState; book: ProjectionBook };

const emptyBook = (): ProjectionBook => ({ seen: {}, lengths: {}, hidden: { voided: {}, hiding: [] } });

const emptyProjection = (): ProjectionState => ({
  laps: [],
  stints: [],
  pitStops: [],
  crossings: [],
  events: [],
  clock: [],
  spans: {},
  flagPhases: [],
  sessionPhases: [],
});

const spanList = (machine: MachineId): FactList => `spans:${machine}`;

/** The length of every list of the projection, keyed like the log's (`spans:<machine>` for the span lists). */
export const projectionLengths = (p: Projection): LogLengths => {
  const lengths: LogLengths = {};
  for (const list of FACT_LISTS) lengths[list] = p[list].length;
  for (const [machine, spans] of Object.entries(p.spans)) lengths[spanList(machine)] = spans.length;
  for (const list of LEGACY_LISTS) lengths[list] = p[list].length;
  return lengths;
};

/** A void range covers position `index` of `list` (C27). */
export const isVoided = (list: FactList | LegacyList, index: number, hidden: HiddenRanges): boolean =>
  hidden.voided[list]?.some(([from, to]) => index >= from && index < to) ?? false;

/** The frames a span covers (C26): from the one it opened on up to, not including, the one it closed on; an open span every frame from its first. */
const covers = (span: { startFrame: FrameNumber; endFrame?: FrameNumber }, frame: FrameNumber): boolean =>
  span.startFrame <= frame && (span.endFrame === undefined || frame < span.endFrame);

/** A span of the hiding kind as the frames it hides: its car's facts only for a car's span. */
const hidingFramesOf = (span: DeepReadonly<OpenSpan> & { endFrame?: FrameNumber }): HidingFrames => ({
  startFrame: span.startFrame,
  ...(span.endFrame !== undefined && { endFrame: span.endFrame }),
  ...(span.carId !== undefined && { carId: span.carId }),
});

/**
 * A fact of `list` is hidden by formation (C29): it is no span and the frame it describes lies in a span of the hiding
 * kind that is the session's (no car) or its own car's, whenever the fact was recorded.
 */
export const isHidden = (fact: { frame: FrameNumber; carId?: CarId }, list: FactList, hidden: HiddenRanges): boolean => {
  if (list.startsWith('spans:')) return false;
  return hidden.hiding.some((h) => covers(h, fact.frame) && (h.carId === undefined || h.carId === fact.carId));
};

/** The void ranges of every void fact, the legacy lists' too, each range once. */
const voidedBy = (voids: readonly DeepReadonly<LogVoidFact>[]): HiddenRanges['voided'] => {
  const voided: HiddenRanges['voided'] = {};
  for (const v of voids) {
    for (const [list, range] of Object.entries({ ...v.ranges, ...v.legacy }) as Array<[FactList | LegacyList, readonly [number, number]]>) {
      const ranges = (voided[list] ??= []);
      if (!ranges.some(([from, to]) => from === range[0] && to === range[1])) ranges.push([range[0], range[1]]);
    }
  }
  return voided;
};

/** The hidden ranges with the open spans of the hiding kind added: a fact can describe a frame of a span still open. */
const withOpen = (hidden: HiddenRanges, open: Situation): HiddenRanges => {
  const spans: DeepReadonly<OpenSpan>[] = [...Object.values(open.byMachine).flat(), ...(open.session ? [open.session] : [])];
  const hiding = spans.filter((s) => s.kind === HIDING_KIND);
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

/**
 * Keeps the projection of one log (C28). Incremental: appends extend the projected lists; a new void fact rebuilds the
 * projection once and reports its target as `rewound` (C30). Writes only the projection and its book, never the log.
 */
export class ProjectionTracker {
  // Typed writable because a projected list can be the log's own array; the tracker never writes through it.
  readonly #log: Log;
  readonly #projection: ProjectionState;
  readonly #book: ProjectionBook;

  constructor(log: DeepReadonly<Log>, holder: ProjectionHolder = { projection: emptyProjection(), book: emptyBook() }) {
    this.#log = log as Log;
    this.#projection = holder.projection;
    this.#book = holder.book;
  }

  get projection(): Projection {
    return this.#projection;
  }

  /** Projects what the log gained since the last update; `open`: the open spans, whose frames can hide facts too. */
  update(open: Situation): HistoryDelta {
    const before = this.#book.lengths;
    const fresh = this.#log.voids.slice(this.#book.seen.voids ?? 0);
    if (fresh.length > 0) this.#rebuild(open);
    else this.#extend(open);
    const after = projectionLengths(this.#projection);
    this.#book.lengths = after;
    const target = fresh.at(-1)?.target;
    return { before, after, ...(target && { rewound: { frameId: target.frameId, at: target.at } }) };
  }

  /**
   * Projects the whole log again. For the old mechanisms that cut or rewrite the log in place (the situation tracker's
   * formation discard, until Task 9).
   */
  rebuild(open: Situation): void {
    this.#rebuild(open);
    this.#book.lengths = projectionLengths(this.#projection);
  }

  #rebuild(open: Situation): void {
    const p = this.#projection;
    for (const list of [...FACT_LISTS, ...LEGACY_LISTS]) p[list] = [];
    p.spans = {};
    this.#book.seen = {};
    this.#book.hidden = { voided: voidedBy(this.#log.voids), hiding: [] };
    this.#extend(open);
  }

  #extend(open: Situation): void {
    const log = this.#log;
    const p = this.#projection;
    const { seen, hidden } = this.#book;
    // Spans first: a closed span of the hiding kind hides the facts describing a frame it covers, also those of this update.
    for (const [machine, spans] of Object.entries(log.spans)) {
      const list = spanList(machine);
      const from = seen[list] ?? 0;
      for (let i = from; i < spans.length; i++) {
        const s = spans[i] as Span;
        if (s.kind === HIDING_KIND && !isVoided(list, i, hidden)) hidden.hiding.push(hidingFramesOf(s));
      }
      p.spans[machine] = project(p.spans[machine], spans, from, (i) => !isVoided(list, i, hidden));
      seen[list] = spans.length;
    }
    const hiding = withOpen(hidden, open);
    for (const list of FACT_LISTS) this.#projectList(list, hiding);
    // The legacy lists are hidden by void ranges only (they describe no frame).
    for (const list of LEGACY_LISTS) {
      (p[list] as unknown[]) = project(p[list] as unknown[], log[list] as unknown[], seen[list] ?? 0, (i) => !isVoided(list, i, hidden));
      seen[list] = log[list].length;
    }
    seen.voids = log.voids.length;
  }

  #projectList<L extends (typeof FACT_LISTS)[number]>(list: L, hiding: HiddenRanges): void {
    const source = this.#log[list] as Array<{ frame: FrameNumber; carId?: CarId }>;
    const current = this.#projection[list] as Array<{ frame: FrameNumber; carId?: CarId }>;
    const from = this.#book.seen[list] ?? 0;
    const visible = (i: number) => !isVoided(list, i, hiding) && !isHidden(source[i] as { frame: FrameNumber; carId?: CarId }, list, hiding);
    (this.#projection[list] as unknown[]) = project(current, source, from, visible);
    this.#book.seen[list] = source.length;
  }
}

/** A new session's log and its projection (both empty, the projected lists the log's own arrays). */
export const newHistory = (open: Situation): { log: Log } & ProjectionHolder => {
  const log = createLog();
  const holder: ProjectionHolder = { projection: emptyProjection(), book: emptyBook() };
  new ProjectionTracker(log, holder).rebuild(open);
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
