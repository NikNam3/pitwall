// The projection (contract C28-C30): the log as readers see it, every hidden fact skipped. The only module that
// computes it. A fact is hidden when a void range covers its position (C27) or, for a fact that is no span, when its
// stamp holds a span of a hiding kind (`formation`, C29); spans are never hidden by a stamp.
import type { CarId, FactList, MachineId, OpenSpan, Span, Stamp, VoidFact } from '@pitwall/domain';
import type { Situation } from '../situations/situation.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { createLog, FACT_LISTS, LEGACY_LISTS } from './log.ts';
import type { HistoryDelta, Log, LogLengths, Projection, ProjectionState } from './types.ts';

/** The span kind whose stamp hides a fact (C29): what the formation lap recorded did not happen in the race. */
const HIDING_KIND = 'formation';

/**
 * What hides facts: per list the void ranges `[from, to)` of log positions (C27, from the void facts), and the closed
 * spans of the hiding kind by `spanKey` (the open ones come with each update's situation).
 */
export type HiddenRanges = {
  voided: Partial<Record<FactList, Array<readonly [from: number, to: number]>>>;
  hidingSpans: Record<string, true>;
};

/** The tracker's bookkeeping, kept in the engine state (`open.projection`) so snapshots carry it. Plain data. */
export type ProjectionBook = {
  /** The log's lengths projected so far. */
  seen: LogLengths;
  /** The projection's lengths after the last update: the next update's `before`. */
  lengths: LogLengths;
  hidden: HiddenRanges;
};

/** The projection and its bookkeeping, as the engine state holds them (`history`, `open.projection`). */
export type ProjectionHolder = { projection: ProjectionState; book: ProjectionBook };

const emptyBook = (): ProjectionBook => ({ seen: {}, lengths: {}, hidden: { voided: {}, hidingSpans: {} } });

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
  pauses: [],
});

/** A span's key: its machine and id, and its car for a car sub-machine's span (span ids count per car there, C26). */
const spanKey = (machine: MachineId, id: number, carId?: CarId): string => (carId === undefined ? `${machine}#${id}` : `${machine}#${carId}#${id}`);

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
export const isVoided = (list: FactList, index: number, hidden: HiddenRanges): boolean =>
  hidden.voided[list]?.some(([from, to]) => index >= from && index < to) ?? false;

/** A fact of `list` is hidden by its stamp: it is no span and its stamp holds a span of the hiding kind (C29). */
export const isHidden = (fact: { in: Stamp }, list: FactList, hidden: HiddenRanges): boolean => {
  if (list.startsWith('spans:')) return false;
  const carId = (fact as { carId?: CarId }).carId;
  for (const [machine, id] of Object.entries(fact.in)) {
    if (hidden.hidingSpans[spanKey(machine, id)] || (carId !== undefined && hidden.hidingSpans[spanKey(machine, id, carId)])) return true;
  }
  return false;
};

/** The void ranges of every void fact, each range once. */
const voidedBy = (voids: readonly DeepReadonly<VoidFact>[]): HiddenRanges['voided'] => {
  const voided: HiddenRanges['voided'] = {};
  for (const v of voids) {
    for (const [list, range] of Object.entries(v.ranges) as Array<[FactList, readonly [number, number]]>) {
      const ranges = (voided[list] ??= []);
      if (!ranges.some(([from, to]) => from === range[0] && to === range[1])) ranges.push([range[0], range[1]]);
    }
  }
  return voided;
};

/** The hidden ranges with the open spans of the hiding kind added: a stamp can name a span that is still open. */
const withOpen = (hidden: HiddenRanges, open: Situation): HiddenRanges => {
  const spans: DeepReadonly<OpenSpan>[] = [...Object.values(open.byMachine).flat(), ...(open.session ? [open.session] : [])];
  const hiding = spans.filter((s) => s.kind === HIDING_KIND);
  if (hiding.length === 0) return hidden;
  const hidingSpans = { ...hidden.hidingSpans };
  for (const s of hiding) hidingSpans[spanKey(s.machine, s.id, s.carId)] = true;
  return { voided: hidden.voided, hidingSpans };
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

  /** Projects what the log gained since the last update; `open`: the open spans, to resolve stamps naming them. */
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
   * Projects the whole log again. For the old mechanisms that cut or rewrite the log in place (the runner's flashback
   * cut until Task 3, the situation tracker's formation discard and start re-stamp until Task 9).
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
    this.#book.hidden = { voided: voidedBy(this.#log.voids), hidingSpans: {} };
    this.#extend(open);
  }

  #extend(open: Situation): void {
    const log = this.#log;
    const p = this.#projection;
    const { seen, hidden } = this.#book;
    // Spans first: a closed span of the hiding kind hides the facts stamped with it, also those of this update.
    for (const [machine, spans] of Object.entries(log.spans)) {
      const list = spanList(machine);
      const from = seen[list] ?? 0;
      for (let i = from; i < spans.length; i++) {
        const s = spans[i] as Span;
        if (s.kind === HIDING_KIND && !isVoided(list, i, hidden)) hidden.hidingSpans[spanKey(s.machine, s.id, s.carId)] = true;
      }
      p.spans[machine] = project(p.spans[machine], spans, from, (i) => !isVoided(list, i, hidden));
      seen[list] = spans.length;
    }
    const hiding = withOpen(hidden, open);
    for (const list of FACT_LISTS) this.#projectList(list, hiding);
    // The legacy lists are never hidden: the projection reads them as they are.
    for (const list of LEGACY_LISTS) {
      (p[list] as unknown[]) = log[list];
      seen[list] = log[list].length;
    }
    seen.voids = log.voids.length;
  }

  #projectList<L extends (typeof FACT_LISTS)[number]>(list: L, hiding: HiddenRanges): void {
    const source = this.#log[list] as Array<{ in: Stamp }>;
    const current = this.#projection[list] as Array<{ in: Stamp }>;
    const from = this.#book.seen[list] ?? 0;
    const visible = (i: number) => !isVoided(list, i, hiding) && !isHidden(source[i] as { in: Stamp }, list, hiding);
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
