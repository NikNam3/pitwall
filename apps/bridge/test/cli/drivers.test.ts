// `pitwall drivers` (SP4.3a Task 6b; C58, C62c, C73, C84): the CLI of the driver profiles. The command runs against a
// fake of Task 6's `ProfileStore` (`DriversDeps.openStore`): it publishes `drivers.profiles` and `drivers.links` to the
// hub it is given, as the real store does, records every action and rejects an override outside its entry's range.
// Every run gets a temporary data dir and HOME (C84) and `PITWALL_WS_PORT` set to a port nothing listens on, so no
// bridge running on this machine is reached; only one test starts a fake bridge, and one (SP4.3b Task 2, row 5) runs the
// real store on its temporary data dir (ruling P3: a running bridge takes the
// action as a uiAction over its WebSocket).
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { CONTRACT_VERSION, encodeMessage, type DriverAction, type ServerMessage, type TopicName } from '@pitwall/contracts';
import { carId, known, unknown, type DriverLink, type DriverPerson, type DriversLinksValue, type DriversProfilesValue, type PersonId, type SessionRef, type UnlinkedSlot } from '@pitwall/domain';
import { run, type ApplyResult, type DriverSessionValues, type DriversDeps, type DriversHub, type DriversStore } from '../../src/cli/commands/drivers.ts';
import type { CliIo } from '../../src/cli/io.ts';

const S1: SessionRef = { sessionUid: '1234', weekendId: 'w1', feedCar: carId(0) };
const S2: SessionRef = { sessionUid: '5678', weekendId: 'w1', feedCar: carId(0) };
const ZANDVOORT = 26;
const SCATTER = 'driverNoise.scatter';
/** The fake's declared range of `SCATTER`; an override outside it is rejected. */
const SCATTER_MAX = 2000;
const NOW = '2026-11-07T12:00:00.000Z';

/**
 * A seat link as a person file holds it (SP4.3b Task 2: `{ team, raceNumber }`). Cast until the supervisor ports
 * `DriverLink` in `domain` to the seat (requested in the Task 2 test report).
 */
const seatLink = (team: number, raceNumber: number): DriverLink => ({ team, raceNumber }) as unknown as DriverLink;

const PROFILES: DriversProfilesValue = {
  persons: [
    {
      person: 'asym', displayName: 'Asymetrisch', links: [seatLink(0, 44)], excluded: [],
      entries: { [SCATTER]: { value: known(412, 0), laps: 12, sessions: 2, newestSession: '2026-11-04' } },
    },
    {
      person: 'dr', displayName: 'DR', links: [], excluded: [],
      entries: { [SCATTER]: { value: known(287, 0), laps: 30, sessions: 3, newestSession: '2026-11-06' } },
    },
  ],
};

const UNLINKED: UnlinkedSlot[] = [
  { session: S2, date: '2026-11-05', trackId: ZANDVOORT, carId: carId(5), teamId: 1, raceNumber: 16, name: null },
  { session: S1, date: '2026-11-04', trackId: ZANDVOORT, carId: carId(3), teamId: 0, raceNumber: 63, name: 'Russell' },
];

const SESSION_VALUES: DriverSessionValues[] = [
  { session: S1, date: '2026-11-03', entries: { [SCATTER]: known(398, 0) } },
  { session: S2, date: '2026-11-04', entries: { [SCATTER]: unknown('insufficientData') } },
];

/** A fake `ProfileStore`: publishes on open and after an accepted action, records actions, opens and closes. */
function fakeStore() {
  const actions: DriverAction[] = [];
  const opened: string[] = [];
  let closed = 0;
  const deps: DriversDeps = {
    now: () => NOW,
    openStore(root: string, hub: DriversHub): DriversStore {
      opened.push(root);
      const publish = (): void => {
        hub.publishGlobal('drivers.profiles' satisfies TopicName, () => PROFILES);
        hub.publishGlobal('drivers.links' satisfies TopicName, (): DriversLinksValue => ({ unlinked: UNLINKED }));
      };
      publish();
      return {
        apply(action): ApplyResult {
          actions.push(action);
          if (action.kind === 'drivers.override' && (action.value < 0 || action.value > SCATTER_MAX)) {
            return { ok: false, reason: 'invalid', message: `${action.key} must lie in 0-${SCATTER_MAX}, got ${action.value}` };
          }
          publish();
          return { ok: true };
        },
        unlinked: () => UNLINKED,
        sessionValues: (person: PersonId) => (person === 'asym' ? SESSION_VALUES : []),
        close: () => {
          closed += 1;
        },
      };
    },
  };
  return { deps, actions, opened, closed: () => closed };
}

/** A port nothing listens on: bound once by the OS, then released. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/** A temporary data dir and HOME, and the env pointing at them and at `wsPort`. */
async function setup(wsPort?: number) {
  const root = mkdtempSync(join(tmpdir(), 'drivers-cli-data-'));
  const home = mkdtempSync(join(tmpdir(), 'drivers-cli-home-'));
  const env = { PITWALL_DATA_DIR: root, HOME: home, PITWALL_WS_PORT: String(wsPort ?? (await closedPort())) };
  return { root, home, env };
}

/** Runs `pitwall drivers <args>` with `deps`; `name` and `accept` are its `--name` and `--accept`. */
async function drivers(args: string[], deps: DriversDeps, env: Record<string, string>, values: { name?: string; accept?: boolean } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env, signal: new AbortController().signal };
  const code = await run(args, values, io, deps);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

/** Each pattern matches a line after the line the previous one matched; returns the matched line indexes. */
function lineIndexes(lines: string[], patterns: RegExp[]): number[] {
  const found: number[] = [];
  let from = 0;
  for (const pattern of patterns) {
    const i = lines.findIndex((l, n) => n >= from && pattern.test(l));
    expect(i, `no line after ${from} matches ${pattern}; output:\n${lines.join('\n')}`).toBeGreaterThanOrEqual(0);
    found.push(i);
    from = i + 1;
  }
  return found;
}

describe('pitwall drivers', () => {
  it('drivers lists persons, then the human seats without a link', async () => {
    const { env } = await setup();
    const store = fakeStore();
    const r = await drivers([], store.deps, env);
    expect(r.code).toBe(0);
    lineIndexes(r.out, [
      /\basym\b.*Asymetrisch/,
      /driverNoise\.scatter.*\b412\b.*\b12 laps\b.*\b2 sessions\b/,
      /\bdr\b.*\bDR\b/,
      /driverNoise\.scatter.*\b287\b.*\b30 laps\b.*\b3 sessions\b/,
      // The unlinked human slots, in the store's order (newest first): date, track, team, race number (the seat to
      // link), the name when the game gave one, the session and slot.
      /2026-11-05.*Zandvoort.*\bteam 1\b.*#16\b.*5678\/w1\/0.*\bslot 5\b/,
      /2026-11-04.*Zandvoort.*\bteam 0\b.*#63\b.*Russell.*1234\/w1\/0.*\bslot 3\b/,
    ]);
    // SP4.3b Task 2: no suggestion any more (U8).
    expect(r.out.join('\n')).not.toMatch(/suggestion/);
    expect(r.err).toBe('');
  });

  it('add, link, unlink, exclude, override call the store with the exact action', async () => {
    const { env } = await setup();
    const store = fakeStore();
    const runs = [
      await drivers(['add', 'asym'], store.deps, env, { name: 'Asymetrisch' }),
      await drivers(['link', '0', '63', 'asym'], store.deps, env),
      await drivers(['unlink', '0', '63'], store.deps, env),
      await drivers(['exclude', 'asym', '5678/w1/0'], store.deps, env),
      await drivers(['override', 'asym', SCATTER, '400'], store.deps, env),
    ];
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0, 0]);
    expect(store.actions).toEqual<DriverAction[]>([
      { kind: 'drivers.add', person: 'asym', displayName: 'Asymetrisch' },
      { kind: 'drivers.link', team: 0, raceNumber: 63, person: 'asym' },
      { kind: 'drivers.link', team: 0, raceNumber: 63, person: null },
      { kind: 'drivers.exclude', person: 'asym', session: S2 },
      { kind: 'drivers.override', person: 'asym', key: SCATTER, value: 400 },
    ]);
  });

  // SP4.3b Task 2, row 5 (C62c, C84): the real store of a temporary data dir; the team by its name (Mercedes: team 0).
  it('pitwall drivers link Mercedes 12 dr writes the link; unlink removes it', async () => {
    const { root, env } = await setup();
    const file = join(root, 'drivers', 'dr.json');
    const person = (): DriverPerson => JSON.parse(readFileSync(file, 'utf8')) as DriverPerson;
    const realRun = async (args: string[], values: { name?: string } = {}) => {
      const err: string[] = [];
      const io: CliIo = { out: () => {}, err: (l) => err.push(l), env, signal: new AbortController().signal };
      const code = await run(args, values, io);
      return { code, err: err.join('\n') };
    };

    expect(await realRun(['add', 'dr'], { name: 'DR' })).toEqual({ code: 0, err: '' });
    expect(await realRun(['link', 'Mercedes', '12', 'dr'])).toEqual({ code: 0, err: '' });
    expect(person().links).toEqual([{ team: 0, raceNumber: 12 }]);
    // The team id as the game numbers it reads the same.
    expect(await realRun(['link', '1', '16', 'dr'])).toEqual({ code: 0, err: '' });
    expect(person().links).toEqual(expect.arrayContaining([{ team: 0, raceNumber: 12 }, { team: 1, raceNumber: 16 }]));

    expect(await realRun(['unlink', 'Mercedes', '12'])).toEqual({ code: 0, err: '' });
    expect(person().links).toEqual([{ team: 1, raceNumber: 16 }]);
    // A team that is none is a usage error, before anything is written.
    const before = readFileSync(file, 'utf8');
    await expect(realRun(['link', 'Nobody', '12', 'dr'])).rejects.toThrow(/team/i);
    expect(readFileSync(file, 'utf8')).toBe(before);
  }, 60_000);

  it('an out-of-range override prints the reason and exits 1', async () => {
    const { env } = await setup();
    const store = fakeStore();
    const r = await drivers(['override', 'asym', SCATTER, '2500'], store.deps, env);
    expect(r.code).toBe(1);
    expect(r.err).toContain(`${SCATTER} must lie in 0-${SCATTER_MAX}, got 2500`);
    expect(store.actions).toEqual([{ kind: 'drivers.override', person: 'asym', key: SCATTER, value: 2500 }]);
  });

  it('show prints each entry with laps, sessions, age and per-session values', async () => {
    const { env } = await setup();
    const store = fakeStore();
    const r = await drivers(['show', 'asym'], store.deps, env);
    expect(r.code).toBe(0);
    lineIndexes(r.out, [
      /\basym\b.*Asymetrisch/,
      // The entry: the profile's value, its laps and sessions, its age (newest session 2026-11-04, now 2026-11-07).
      /driverNoise\.scatter.*\b412\b.*\b12 laps\b.*\b2 sessions\b.*\b3 d\b/,
      // Each linked session's own value beside the profile's; a missing one is unknown, never 0 (C3).
      /1234\/w1\/0.*2026-11-03.*\b398\b.*\b412\b/,
      /5678\/w1\/0.*2026-11-04.*unknown.*\b412\b/,
    ]);
    expect(r.out.find((l) => l.includes('5678/w1/0'))).not.toMatch(/(^|\s)0(\s|$)/);
  });

  it('writes nothing outside the temporary data dir', async () => {
    const { root, home, env } = await setup();
    const store = fakeStore();
    const cwdBefore = readdirSync(process.cwd()).toSorted();
    const runs = [
      await drivers([], store.deps, env),
      await drivers(['add', 'asym'], store.deps, env, { name: 'Asymetrisch' }),
      await drivers(['link', '0', '63', 'asym'], store.deps, env),
      await drivers(['unlink', '0', '63'], store.deps, env),
      await drivers(['exclude', 'asym', '5678/w1/0'], store.deps, env),
      await drivers(['override', 'asym', SCATTER, '400'], store.deps, env),
      await drivers(['show', 'asym'], store.deps, env),
    ];
    expect(runs.map((r) => r.code)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Every run opened the store of the temporary data dir and closed it again (its lock released).
    expect(store.opened).toEqual(Array.from({ length: runs.length }, () => root));
    expect(store.closed()).toBe(runs.length);
    expect(readdirSync(home)).toEqual([]);
    expect(readdirSync(process.cwd()).toSorted()).toEqual(cwdBefore);
  });

  it('with a running bridge the action goes to it, without one to the store', async () => {
    // A fake bridge: greets as the bridge does and answers every uiAction, rejecting an override.
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    cleanup.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
    await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
    const received: DriverAction[] = [];
    wss.on('connection', (socket) => {
      socket.send(encodeMessage({ type: 'hello', contractVersion: CONTRACT_VERSION, feeds: [] } satisfies ServerMessage));
      socket.on('message', (data) => {
        // Parsed as it is: the contracts decoder learns the `drivers.*` actions in Task 6.
        const message = JSON.parse(data.toString()) as { type: string; id: string; action: DriverAction };
        if (message.type !== 'uiAction') return;
        received.push(message.action);
        const answer: ServerMessage =
          message.action.kind === 'drivers.override'
            ? { type: 'actionResult', id: message.id, ok: false, reason: 'invalid', message: 'rejected by the bridge' }
            : { type: 'actionResult', id: message.id, ok: true };
        socket.send(encodeMessage(answer));
      });
    });
    const { port } = wss.address() as { port: number };

    const running = await setup(port);
    const withBridge = fakeStore();
    const added = await drivers(['add', 'asym'], withBridge.deps, running.env, { name: 'Asymetrisch' });
    expect(added.code).toBe(0);
    const rejected = await drivers(['override', 'asym', SCATTER, '400'], withBridge.deps, running.env);
    expect(rejected.code).toBe(1);
    expect(rejected.err).toContain('rejected by the bridge');
    expect(received).toEqual<DriverAction[]>([
      { kind: 'drivers.add', person: 'asym', displayName: 'Asymetrisch' },
      { kind: 'drivers.override', person: 'asym', key: SCATTER, value: 400 },
    ]);
    // The bridge holds the lock: the command never opens the store beside it.
    expect(withBridge.opened).toEqual([]);

    const none = await setup();
    const withoutBridge = fakeStore();
    const alone = await drivers(['add', 'asym'], withoutBridge.deps, none.env, { name: 'Asymetrisch' });
    expect(alone.code).toBe(0);
    expect(withoutBridge.opened).toEqual([none.root]);
    expect(withoutBridge.actions).toEqual<DriverAction[]>([{ kind: 'drivers.add', person: 'asym', displayName: 'Asymetrisch' }]);
    expect(received).toHaveLength(2);
  });
});
