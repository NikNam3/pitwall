// The append-only log (contract C21-C24): one list per fact type, the void facts and one span list per sub-machine.
// Only the projection, the runner, step, the history writers and the storage writer import this module (C28).
import type { FactList, MachineId } from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { FactOf, LegacyList, Log, LogLengths, LogWriter } from './types.ts';

/** The lists of the log that hold one fact type each; the span lists are `spans:<machine>`. */
export const FACT_LISTS = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'clock'] as const satisfies readonly FactList[];
export const LEGACY_LISTS = ['flagPhases', 'sessionPhases', 'pauses'] as const satisfies readonly LegacyList[];

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
  pauses: [],
});

/** The array of a list; a span list a sub-machine has not written yet is created. */
const listOf = <L extends FactList>(log: Log, list: L): Array<FactOf<L>> => {
  const machine = machineOf(list);
  if (machine === undefined) return log[list as Exclude<FactList, `spans:${string}`>] as Array<FactOf<L>>;
  return (log.spans[machine] ??= []) as Array<FactOf<L>>;
};

/** The writer of `log` (C22): appends a fact to the end of its list and returns its id. */
export const logWriter = (log: Log): LogWriter => ({
  append<L extends FactList>(list: L, fact: FactOf<L>) {
    const facts = listOf(log, list);
    facts.push(fact);
    return { list, index: facts.length - 1 };
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

/**
 * Cuts every list back to its length in `to` (a list missing in `to` is emptied). Only the runner's flashback calls it,
 * until Task 3 replaces the cut with a void fact; the log is otherwise append-only (C24).
 */
export const truncateLog = (log: Log, to: LogLengths): void => {
  for (const list of [...FACT_LISTS, 'voids', ...LEGACY_LISTS] as const) log[list].splice(to[list] ?? 0);
  for (const [machine, spans] of Object.entries(log.spans)) spans.splice(to[`${SPANS}${machine}`] ?? 0);
};
