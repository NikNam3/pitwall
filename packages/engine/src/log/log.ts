// The append-only log (contract C21-C24): one list per fact type, the void facts and one span list per sub-machine.
// Only the projection, the runner, step, the history writers and the storage writer import this module (C28).
import type { FactList, FrameNumber, MachineId } from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { FactOf, LegacyList, Log, LogLengths, LogVoidFact, LogWriter } from './types.ts';

/** The lists of the log that hold one fact type each; the span lists are `spans:<machine>`. */
export const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'clock'] as const satisfies readonly FactList[];
export const LEGACY_LISTS = ['flagPhases', 'sessionPhases'] as const satisfies readonly LegacyList[];

const SPANS = 'spans:';

/** The machine of a span list, or `undefined` for a fixed list. */
export const machineOf = (list: FactList): MachineId | undefined => (list.startsWith(SPANS) ? list.slice(SPANS.length) : undefined);

/** A log with every list empty. */
export const createLog = (): Log => ({
  laps: [],
  stints: [],
  pitStops: [],
  crossings: [],
  events: [],
  clock: [],
  voids: [],
  spans: {},
  flagPhases: [],
  sessionPhases: [],
});

/** The array of a list; a span list a sub-machine has not written yet is created. */
const listOf = <L extends FactList>(log: Log, list: L): Array<FactOf<L>> => {
  const machine = machineOf(list);
  if (machine === undefined) return log[list as Exclude<FactList, `spans:${string}`>] as Array<FactOf<L>>;
  return (log.spans[machine] ??= []) as Array<FactOf<L>>;
};

/**
 * The id of the fact at log position `position` of `list` (C21): the number of facts of the list before it in the
 * current timeline, those no void range covers. Void ranges are log positions; two may overlap (a later rewind to a
 * target before an earlier one's), so each voided position counts once.
 */
const currentIndexOf = (log: Log, list: FactList, position: number): number => {
  const ranges = log.voids.flatMap((v) => (v.ranges[list] ? [v.ranges[list]] : [])).sort((a, b) => a[0] - b[0]);
  let voided = 0;
  let reached = 0;
  for (const [from, to] of ranges) {
    const lo = Math.max(from, reached);
    const hi = Math.min(to, position);
    if (hi > lo) voided += hi - lo;
    reached = Math.max(reached, to);
  }
  return position - voided;
};

/**
 * The writer of `log` (C22): appends a fact to the end of its list and returns its id (C21): its list and the number of
 * the list's facts before it in the current timeline, so after a rewind a replayed fact gets the id a run without the
 * rewind gives it (C33).
 */
export const logWriter = (log: Log): LogWriter => ({
  append<L extends FactList>(list: L, fact: FactOf<L>) {
    const facts = listOf(log, list);
    facts.push(fact);
    return { list, index: currentIndexOf(log, list, facts.length - 1) };
  },
  lengths: () => logLengths(log),
});

/** The length of every list of the log, the span lists by `spans:<machine>`. */
export const logLengths = (log: DeepReadonly<Log>): LogLengths => {
  const lengths: LogLengths = {};
  for (const list of FACT_LISTS) lengths[list] = log[list].length;
  lengths.voids = log.voids.length;
  for (const [machine, spans] of Object.entries(log.spans)) lengths[`${SPANS}${machine}`] = spans.length;
  for (const list of LEGACY_LISTS) lengths[list] = log[list].length;
  return lengths;
};

const isLegacy = (list: string): list is LegacyList => (LEGACY_LISTS as readonly string[]).includes(list);

/**
 * The void fact of a rewind (C27): every list that grew since `since` (the lengths at the restored snapshot) is voided
 * from its length then to its length now, the legacy lists too (in `legacy`); `target` is the frame the state was
 * restored to and `frame` its frame number (C26). Nothing is removed: the log only grows (C24).
 */
export const voidFactOf = (log: DeepReadonly<Log>, since: LogLengths, target: LogVoidFact['target'], frame: FrameNumber): LogVoidFact => {
  const ranges: LogVoidFact['ranges'] = {};
  const legacy: NonNullable<LogVoidFact['legacy']> = {};
  for (const [list, now] of Object.entries(logLengths(log)) as Array<[FactList | LegacyList, number]>) {
    const from = since[list] ?? 0;
    if (list === 'voids' || now <= from) continue;
    if (isLegacy(list)) legacy[list] = [from, now];
    else ranges[list] = [from, now];
  }
  return { target, ranges, ...(Object.keys(legacy).length > 0 && { legacy }), frame };
};
