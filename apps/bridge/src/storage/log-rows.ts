// A session's log as fact rows and back (C24, C60): one row per fact, by its list (`laps` … `clock`, `voids`,
// `spans:<machine>`) and its position in it, the record as JSON.
import { FACT_LISTS, machineOf, type Log } from '@pitwall/engine/log';
import type { FactList } from '@pitwall/domain';
import type { DeepReadonly } from '@pitwall/engine/readers';

/** A fact as storage writes it: `carId` is the fact's or span's car, else null. */
export type FactRow = { list: string; seq: number; carId: number | null; record: string };

/** A stored fact as read back, in list and position order. */
export type StoredFact = { list: string; record: string };

const carIdOf = (fact: unknown): number | null => {
  const carId = (fact as { carId?: unknown }).carId;
  return typeof carId === 'number' ? carId : null;
};

/** Every list of the log with its facts: the fact lists, the void facts, then one span list per sub-machine. */
const listsOf = (log: DeepReadonly<Log>): Array<[list: string, facts: readonly unknown[]]> => [
  ...FACT_LISTS.map((list): [string, readonly unknown[]] => [list, log[list]]),
  ['voids', log.voids],
  ...Object.entries(log.spans).map(([machine, spans]): [string, readonly unknown[]] => [`spans:${machine}`, spans]),
];

/** The facts of `log` from position `from(list)` on, per list, as rows. */
export const logRows = (log: DeepReadonly<Log>, from: (list: string) => number): FactRow[] =>
  listsOf(log).flatMap(([list, facts]) =>
    facts.slice(from(list)).map((fact, i) => ({ list, seq: from(list) + i, carId: carIdOf(fact), record: JSON.stringify(fact) })),
  );

/** The log the rows hold, each list in position order. */
export const logOfRows = (rows: readonly StoredFact[]): Log => {
  const log: Log = { laps: [], stints: [], pitStops: [], crossings: [], events: [], penalties: [], decisions: [], clock: [], voids: [], spans: {} };
  const fixed = new Set<string>(FACT_LISTS);
  for (const { list, record } of rows) {
    const fact: unknown = JSON.parse(record);
    const machine = machineOf(list as FactList);
    if (machine !== undefined) (log.spans[machine] ??= []).push(fact as Log['spans'][string][number]);
    else if (list === 'voids') log.voids.push(fact as Log['voids'][number]);
    else if (fixed.has(list)) (log[list as (typeof FACT_LISTS)[number]] as unknown[]).push(fact);
  }
  return log;
};
