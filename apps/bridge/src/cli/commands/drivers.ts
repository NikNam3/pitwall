// `pitwall drivers` (C62c, SP4.3a spec 4, Task 6b): lists, links and edits the driver profiles. With a running bridge
// (its WebSocket port, `PITWALL_WS_PORT`, answers) an edit goes to it as a uiAction and its answer is printed, and the
// list reads its `drivers.profiles` and `drivers.links` topics; without one the command opens the profile store itself,
// under the lock `drivers/.lock` (ruling P3). `show` needs the store (the per-session values are not published): with a
// running bridge it says so and exits 1 (ruling R29). `<session>` is printed and parsed as
// `<sessionUid>/<weekendId>/<feedCar>`, a seat as `<team> <raceNumber>` (the team by name or id). A rejected action
// prints its reason and exits 1 (C73).
import type { DriverAction, TopicName } from '@pitwall/contracts';
import { carId, teamIdByName, trackName, type DriversLinksValue, type DriversProfilesValue, type Known, type PersonId, type StoredSessionRef, type TeamId, type UnlinkedSlot } from '@pitwall/domain';
import { loadConfig } from '../../config.ts';
import type { ApplyResult, DriverSessionValues } from '../../drivers/store.ts';
import type { ValueFor } from '../../hub/topic-hub.ts';
import { dataDir } from '../../storage/data-dir.ts';
import type { CliIo } from '../io.ts';
import { UsageError } from '../usage.ts';
import { connect, sendAction, topicValue, type Bridge } from './bridge-client.ts';

export type { ApplyResult, DriverSessionValues } from '../../drivers/store.ts';

/** Where the store publishes `drivers.profiles` and `drivers.links` (C54, C55); the CLI reads the persons from it. */
export type DriversHub = { publishGlobal(topic: TopicName, valueFor: ValueFor): void };

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

export type DriversValues = { name?: string | undefined };

const DAY_MS = 86_400_000;

// ---- parsing ----

const sessionText = (s: StoredSessionRef): string => `${s.sessionUid}/${s.weekendId}/${s.feedCar}`;

function parseSession(text: string | undefined): StoredSessionRef {
  const [sessionUid, weekendId, feedCar] = /^([^/\s]+)\/([^/\s]+)\/(\d+)$/.exec(text ?? '')?.slice(1) ?? [];
  if (sessionUid === undefined || weekendId === undefined || feedCar === undefined) {
    throw new UsageError(`a session is <sessionUid>/<weekendId>/<feedCar>, got "${text ?? ''}"`);
  }
  return { sessionUid, weekendId, feedCar: carId(Number(feedCar)) };
}

/** A seat: the team by its name (`Mercedes`, case-insensitive) or its id, and the race number. */
function parseSeat(teamText: string | undefined, numberText: string | undefined): { team: TeamId; raceNumber: number } {
  const text = need(teamText, 'a team');
  const team = /^\d+$/.test(text) ? Number(text) : teamIdByName(text);
  if (team === undefined) throw new UsageError(`a team is a team name (Mercedes, Ferrari, …) or its id, got "${text}"`);
  const raceNumber = need(numberText, 'a race number');
  if (!/^\d+$/.test(raceNumber)) throw new UsageError(`a race number is a whole number, got "${raceNumber}"`);
  return { team, raceNumber: Number(raceNumber) };
}

function need(text: string | undefined, what: string): string {
  if (text === undefined || text === '') throw new UsageError(`drivers needs ${what}`);
  return text;
}

/** The action a `drivers <verb> …` line asks for. */
function actionOf(verb: string, args: string[], values: DriversValues): DriverAction {
  switch (verb) {
    case 'add':
      return { kind: 'drivers.add', person: need(args[0], 'a person'), displayName: need(values.name, '--name "<display name>"') };
    case 'link':
      return { kind: 'drivers.link', ...parseSeat(args[0], args[1]), person: need(args[2], 'a person') };
    case 'unlink':
      return { kind: 'drivers.link', ...parseSeat(args[0], args[1]), person: null };
    case 'exclude':
      return { kind: 'drivers.exclude', person: need(args[0], 'a person'), session: parseSession(args[1]) };
    case 'override': {
      const value = Number(need(args[2], 'a value'));
      if (!Number.isFinite(value)) throw new UsageError(`the override value must be a number, got "${args[2]}"`);
      return { kind: 'drivers.override', person: need(args[0], 'a person'), key: need(args[1], 'an entry key'), value };
    }
    default:
      throw new UsageError(`unknown drivers command "${verb}"`);
  }
}

// ---- output ----

const valueText = (value: Known<number>): string => (value.known ? String(value.value) : `unknown (${value.reason})`);

const personLine = (p: DriversProfilesValue['persons'][number]): string => `${p.person}  ${p.displayName}`;

function listLines(profiles: DriversProfilesValue, unlinked: readonly UnlinkedSlot[]): string[] {
  const lines: string[] = [];
  if (profiles.persons.length === 0) lines.push('no persons');
  for (const p of profiles.persons) {
    lines.push(personLine(p));
    for (const [key, e] of Object.entries(p.entries)) lines.push(`  ${key}  ${valueText(e.value)}  ${e.laps} laps  ${e.sessions} sessions`);
  }
  lines.push('', unlinked.length === 0 ? 'no unlinked human slots' : 'unlinked human slots:');
  for (const s of unlinked) {
    const parts = [s.date, trackName(s.trackId) ?? `track ${s.trackId}`, `team ${s.teamId}`, `#${s.raceNumber}`];
    if (s.name !== null) parts.push(s.name);
    parts.push(sessionText(s.session), `slot ${s.carId}`);
    lines.push(`  ${parts.join('  ')}`);
  }
  return lines;
}

/** Whole days from `newest` (an ISO date) to `now`; unknown without a session. */
const ageText = (newest: string, now: string): string => {
  const days = Math.floor((Date.parse(now) - Date.parse(newest)) / DAY_MS);
  return newest === '' || !Number.isFinite(days) ? 'age unknown' : `${days} d`;
};

function showLines(p: DriversProfilesValue['persons'][number], sessions: readonly DriverSessionValues[], now: string): string[] {
  const lines = [personLine(p)];
  for (const link of p.links) lines.push(`  link team ${link.team} #${link.raceNumber}`);
  for (const session of p.excluded) lines.push(`  excluded ${sessionText(session)}`);
  for (const [key, e] of Object.entries(p.entries)) {
    lines.push(`  ${key}  ${valueText(e.value)}  ${e.laps} laps  ${e.sessions} sessions  ${ageText(e.newestSession, now)}`);
    for (const s of sessions) {
      lines.push(`    ${sessionText(s.session)}  ${s.date}  ${valueText(s.entries[key] ?? { known: false, reason: 'notApplicable' })}  profile ${valueText(e.value)}`);
    }
  }
  return lines;
}

// ---- the store, opened by the command ----

/** A hub that keeps what the store publishes, so the command reads the topics' values as a window would. */
function capturingHub(): DriversHub & { value(topic: TopicName): unknown } {
  const published = new Map<TopicName, ValueFor>();
  return {
    publishGlobal: (topic, valueFor) => published.set(topic, valueFor),
    value: (topic) => published.get(topic)?.({}),
  };
}

const failed = (io: CliIo, result: ApplyResult): number => {
  if (result.ok) return 0;
  io.err(`pitwall: ${result.message}`);
  return 1;
};

function withStore(verb: string | undefined, args: string[], values: DriversValues, io: CliIo, deps: DriversDeps): number {
  const action = verb === undefined || verb === 'show' ? undefined : actionOf(verb, args, values);
  const root = dataDir(io.env).root;
  const hub = capturingHub();
  const store = deps.openStore(root, hub);
  try {
    if (action !== undefined) return failed(io, store.apply(action));
    const profiles = (hub.value('drivers.profiles') as DriversProfilesValue | undefined) ?? { persons: [] };
    if (verb === undefined) {
      for (const line of listLines(profiles, store.unlinked())) io.out(line);
      return 0;
    }
    const person = need(args[0], 'a person');
    const found = profiles.persons.find((p) => p.person === person);
    if (found === undefined) {
      io.err(`pitwall: no person "${person}"`);
      return 1;
    }
    for (const line of showLines(found, store.sessionValues(person), deps.now())) io.out(line);
    return 0;
  } finally {
    store.close();
  }
}

/** The real store of the data dir: its database and the features' profile declarations, loaded only when the command opens it. */
async function defaultDeps(io: CliIo): Promise<DriversDeps> {
  const [{ ProfileStore }, { FEATURES }, { loadFeatureConfig }, { openDatabase }, { rulesVersion, SOURCE_ROOT }, { WeekendRepository }, tracks, { cliLogger }] = await Promise.all([
    import('../../drivers/store.ts'),
    import('../../features/index.generated.ts'),
    import('../../feature-config.ts'),
    import('../../storage/db.ts'),
    import('../../storage/rules-version.ts'),
    import('../../storage/weekend-repository.ts'),
    import('../../track-files/load.ts'),
    import('../io.ts'),
  ]);
  const version = await rulesVersion(SOURCE_ROOT);
  return {
    now: () => new Date().toISOString(),
    openStore(root, hub) {
      const dirs = dataDir({ PITWALL_DATA_DIR: root });
      const db = openDatabase(dirs.dbPath);
      let stale = 0;
      try {
        const repo = new WeekendRepository(db, {
          rulesVersion: version,
          track: (row) => (row.pwrecPath === null ? tracks.loadTrackFile(row.trackId, tracks.TRACKS_DIR) : tracks.recordingTrack(row.pwrecPath, row.trackId, tracks.TRACKS_DIR)),
        });
        const store = ProfileStore.open(root, {
          features: FEATURES,
          repo,
          config: loadFeatureConfig(root, FEATURES),
          hub,
          log: cliLogger(io, 'warn'),
          // The command rebuilds nothing: a stale session stays out until the bridge or `pitwall reprocess` rebuilds it (C61).
          rebuild: async (keys) => {
            stale += keys.length;
          },
        });
        return {
          apply: (action) => store.apply(action),
          unlinked: () => store.unlinked(),
          sessionValues: (person) => store.sessionValues(person),
          close: () => {
            store.close();
            db.close();
            if (stale > 0) io.err(`pitwall: ${stale} stored sessions are stale and left out; start the bridge or run "pitwall reprocess" to rebuild them`);
          },
        };
      } catch (error) {
        db.close();
        throw error;
      }
    },
  };
}

// ---- a running bridge ----

/** A global topic's current value; a bridge that publishes none is an error. */
async function globalValue(bridge: Bridge, topic: TopicName, id: string): Promise<unknown> {
  const value = await topicValue(bridge, topic, id);
  if (value === undefined) throw new Error(`the bridge publishes no ${topic}`);
  return value;
}

async function onBridge(bridge: Bridge, verb: string | undefined, args: string[], values: DriversValues, io: CliIo): Promise<number> {
  if (verb === 'show') {
    io.err('pitwall: the bridge is running and holds the profile store; "drivers show" needs it: stop the bridge first');
    return 1;
  }
  if (verb === undefined) {
    const profiles = (await globalValue(bridge, 'drivers.profiles', 'drivers-profiles')) as DriversProfilesValue;
    const links = (await globalValue(bridge, 'drivers.links', 'drivers-links')) as DriversLinksValue;
    for (const line of listLines(profiles, links.unlinked)) io.out(line);
    return 0;
  }
  const refusal = await sendAction(bridge, actionOf(verb, args, values), 'drivers-action');
  if (refusal === undefined) return 0;
  io.err(`pitwall: ${refusal}`);
  return 1;
}

/** `pitwall drivers [add|link|unlink|exclude|override|show] …`. */
export async function run(positionals: string[], values: DriversValues, io: CliIo, deps?: DriversDeps): Promise<number> {
  const [verb, ...args] = positionals;
  if (verb !== undefined && verb !== 'show') actionOf(verb, args, values); // a usage error before any connection
  const bridge = await connect(loadConfig(io.env).wsPort, io);
  if (bridge !== undefined) {
    try {
      return await onBridge(bridge, verb, args, values, io);
    } finally {
      bridge.close();
    }
  }
  return withStore(verb, args, values, io, deps ?? (await defaultDeps(io)));
}
