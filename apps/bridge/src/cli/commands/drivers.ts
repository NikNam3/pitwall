// `pitwall drivers` (C62c, SP4.3a spec 4, Task 6b): lists, links and edits the driver profiles. With a running bridge
// (its WebSocket port, `PITWALL_WS_PORT`, answers) an edit goes to it as a uiAction and its answer is printed; without
// one the command opens the profile store itself, under the lock `drivers/.lock` (ruling P3). `<session>` is printed and
// parsed as `<sessionUid>/<weekendId>/<feedCar>`. A rejected action prints its reason and exits 1 (C73).
import type { DriverAction, TopicName } from '@pitwall/contracts';
import type { Known, PersonId, SessionRef, UnlinkedSlot } from '@pitwall/domain';
import type { ValueFor } from '../../hub/topic-hub.ts';
import type { CliIo } from '../io.ts';

/** The answer to a driver-profile uiAction (C73), as Task 6's `ProfileStore.apply` gives it. */
export type ApplyResult = { ok: true } | { ok: false; reason: 'invalid'; message: string };

/** Where the store publishes `drivers.profiles` and `drivers.links` (C54, C55); the CLI reads the persons from it. */
export type DriversHub = { publishGlobal(topic: TopicName, valueFor: ValueFor): void };

/** One linked session's own value of each entry: the entry's `aggregate` over that one session (`drivers show`). */
export type DriverSessionValues = { session: SessionRef; date: string; entries: Record<string, Known<number>> };

/** What `pitwall drivers` uses of Task 6's `ProfileStore`. */
export type DriversStore = {
  apply(action: DriverAction): ApplyResult;
  unlinked(): UnlinkedSlot[];
  /** The person's linked sessions, oldest first, each with its own value of every entry. */
  sessionValues(person: PersonId): DriverSessionValues[];
  /** Releases the lock. */
  close(): void;
};

export type DriversDeps = {
  /** Opens the store of the data dir `root` under its lock; it publishes its topics to `hub` on open and after each edit. */
  openStore(root: string, hub: DriversHub): DriversStore;
  /** Now as an ISO timestamp, for an entry's age. */
  now(): string;
};

export type DriversValues = { name?: string | undefined; accept?: boolean | undefined };

/** `pitwall drivers [add|link|exclude|override|show] …`. */
export async function run(_positionals: string[], _values: DriversValues, _io: CliIo, _deps?: DriversDeps): Promise<number> {
  throw new Error('not implemented');
}
