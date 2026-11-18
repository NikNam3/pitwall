// `pitwall basis` and `pitwall plans` (SP4.3e Task 7c-1, spec §4.2–4.3; C58, C72): the CLI picker of a running bridge.
// Every run goes through `main` (the command line as typed) against a fake bridge: a WebSocket server that greets with
// one feed, answers a subscription to `basis.active` or `plans.prepared` with a snapshot, and answers every uiAction,
// rejecting the ones a test names. A session is written `<sessionUid>/<weekendId>`, as `pitwall basis` prints it.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { CONTRACT_VERSION, encodeMessage, type ClientMessage, type ServerMessage, type UiAction } from '@pitwall/contracts';
import { feedId, IMPORTED, type PreparedCar, type RaceAssumptions, type SessionBasis, type SessionRef, type TeamId, type TrackId } from '@pitwall/domain';
import type { CliIo } from '../../src/cli/io.ts';
import { main } from '../../src/cli/pitwall.ts';

const FEED = feedId('live');
const WEEKEND = '548397152';
const PRACTICE: SessionRef = { sessionUid: '4011121896695002375', weekendId: WEEKEND };
const QUALIFYING: SessionRef = { sessionUid: '12101553556244014932', weekendId: WEEKEND };
const PRACTICE_TEXT = `${PRACTICE.sessionUid}/${WEEKEND}`;
const QUALIFYING_TEXT = `${QUALIFYING.sessionUid}/${WEEKEND}`;
const AUSTIN = 15;
const PLAN_ID = 'texas-2026-11-18-0940';

/**
 * `BasisActive` (`topics/basis.active.ts`) and the open `PlanningRoundState` (`topics/plans.prepared.ts`) as the topic
 * files declare them; written out here because the contracts index does not export them (requested in the report).
 */
type BasisActive = {
  basis: SessionBasis;
  start: SessionBasis;
  sessions: Record<string, { date: string; kind: 'practice' | 'qualifying'; trackId: TrackId }>;
  plan: { id: string; name: string; laps: number } | null;
  raceLaps: number | null;
  rebuilding: { done: number; total: number } | null;
  lastChoice: { basis: SessionBasis; plan: string | null } | null;
};
type PlanningRoundState = {
  open: true;
  qualifying: SessionRef;
  practice: SessionRef[];
  race: RaceAssumptions;
  team: TeamId;
  cars: Record<string, PreparedCar>;
  running: boolean;
  saved: { id: string; name: string; savedAt: string }[];
};

const BASIS_ACTIVE: BasisActive = {
  basis: { practice: [PRACTICE], qualifying: QUALIFYING },
  start: { practice: [PRACTICE], qualifying: null },
  sessions: {
    [`${PRACTICE.sessionUid}@${WEEKEND}`]: { date: '2026-11-16', kind: 'practice', trackId: AUSTIN },
    [`${QUALIFYING.sessionUid}@${WEEKEND}`]: { date: '2026-11-17', kind: 'qualifying', trackId: AUSTIN },
  },
  plan: { id: PLAN_ID, name: 'Texas 18 Nov 09:40', laps: 28 },
  raceLaps: 56,
  rebuilding: null,
  lastChoice: null,
};

const ROUND: PlanningRoundState = {
  open: true,
  qualifying: QUALIFYING,
  practice: [PRACTICE],
  race: { laps: 56, sets: 'carried', conditions: IMPORTED },
  team: 0,
  cars: {},
  running: false,
  saved: [
    { id: PLAN_ID, name: 'Texas 18 Nov 09:40', savedAt: '2026-11-18T09:40:00.000Z' },
    { id: 'texas-two-stop', name: 'Texas two-stop', savedAt: '2026-11-17T21:05:00.000Z' },
  ],
};

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/**
 * A fake bridge on a free port: greets with the one feed `FEED`, answers `basis.active` and `plans.prepared` with their
 * snapshots (any other topic with `noData`) and every uiAction with `ok`, except the kinds in `reject`.
 */
/** `plans.sessions` (C54): the qualifying stored for `team` (the round's team comes from it, C62d). */
const storedFor = (team: number) => ({ sessions: [{ ref: QUALIFYING, kind: 'qualifying', trackId: 15, startedAt: '2026-11-17T22:07:29.991Z', team, cars: [], stale: false }] });

async function fakeBridge(reject: Partial<Record<UiAction['kind'], string>> = {}, sessions: unknown = storedFor(0)) {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  cleanup.push(() => new Promise<void>((resolve) => wss.close(() => resolve())));
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const received: ClientMessage[] = [];
  wss.on('connection', (socket) => {
    socket.send(encodeMessage({ type: 'hello', contractVersion: CONTRACT_VERSION, feeds: [{ feedId: FEED, kind: 'udp', label: 'UDP 20777', team: 0 }] } satisfies ServerMessage));
    socket.on('message', (data) => {
      // Parsed as it is, so the test sees every message the command sends.
      const message = JSON.parse(data.toString()) as ClientMessage;
      received.push(message);
      if (message.type === 'subscribe') {
        const value = message.topic === 'basis.active' ? BASIS_ACTIVE : message.topic === 'plans.prepared' ? ROUND : message.topic === 'plans.sessions' ? sessions : undefined;
        const answer: ServerMessage = value === undefined ? { type: 'topicStatus', id: message.id, status: 'noData' } : { type: 'snapshot', id: message.id, value };
        socket.send(encodeMessage(answer));
      }
      if (message.type === 'uiAction') {
        const refusal = reject[message.action.kind];
        const answer: ServerMessage =
          refusal === undefined ? { type: 'actionResult', id: message.id, ok: true } : { type: 'actionResult', id: message.id, ok: false, reason: 'invalid', message: refusal };
        socket.send(encodeMessage(answer));
      }
    });
  });
  const { port } = wss.address() as { port: number };
  return {
    port,
    received,
    actions: () => received.flatMap((m) => (m.type === 'uiAction' ? [m.action] : [])),
    subscriptions: () => received.flatMap((m) => (m.type === 'subscribe' ? [m] : [])),
  };
}

/** Runs `pitwall <argv>` against the bridge on `port`, with a temporary data dir and HOME (C84). */
async function pitwall(argv: string[], port: number) {
  const env = {
    PITWALL_WS_PORT: String(port),
    PITWALL_DATA_DIR: mkdtempSync(join(tmpdir(), 'basis-cli-data-')),
    HOME: mkdtempSync(join(tmpdir(), 'basis-cli-home-')),
  };
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env, signal: new AbortController().signal };
  const code = await main(argv, io);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

describe('pitwall basis and pitwall plans', { timeout: 30_000 }, () => {
  it('pitwall basis prints the feed\'s basis with dates', async () => {
    const bridge = await fakeBridge();
    const r = await pitwall(['basis'], bridge.port);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    // It reads the feed's `basis.active` (the one feed of the bridge).
    expect(bridge.subscriptions()).toEqual([expect.objectContaining({ topic: 'basis.active', feedId: FEED })]);
    const text = r.out.join('\n');
    // Per kind each named session with its date; the chosen plan by its name.
    expect(r.out.find((l) => l.includes(PRACTICE_TEXT))).toMatch(/practice.*2026-11-16|2026-11-16.*practice/i);
    expect(r.out.find((l) => l.includes(QUALIFYING_TEXT))).toMatch(/qualifying.*2026-11-17|2026-11-17.*qualifying/i);
    expect(r.out.find((l) => l.includes('Texas 18 Nov 09:40'))).toMatch(/plan/i);
    expect(text).toContain(PRACTICE_TEXT);
    expect(bridge.actions()).toEqual([]);
  });

  it('pitwall basis choose --practice … --qualifying … --plan <id> sends one basis.choose', async () => {
    const bridge = await fakeBridge();
    const r = await pitwall(['basis', 'choose', '--practice', PRACTICE_TEXT, '--qualifying', QUALIFYING_TEXT, '--plan', PLAN_ID], bridge.port);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(bridge.actions()).toEqual<UiAction[]>([
      { kind: 'basis.choose', feedId: FEED, basis: { practice: [PRACTICE], qualifying: QUALIFYING }, plan: PLAN_ID },
    ]);
  });

  it('--qualifying none sends qualifying: null', async () => {
    const bridge = await fakeBridge();
    const r = await pitwall(['basis', 'choose', '--practice', PRACTICE_TEXT, '--qualifying', 'none'], bridge.port);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    const actions = bridge.actions();
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: 'basis.choose', feedId: FEED, basis: { practice: [PRACTICE], qualifying: null } });
    // Without --plan the plan is kept: `plan` is undefined (absent on the wire), never `null` (none).
    expect((actions[0] as Extract<UiAction, { kind: 'basis.choose' }>).plan).toBeUndefined();
  });

  it('pitwall plans lists saved plans', async () => {
    const bridge = await fakeBridge();
    const r = await pitwall(['plans'], bridge.port);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(bridge.subscriptions()).toEqual([expect.objectContaining({ topic: 'plans.prepared', feedId: FEED })]);
    // Each saved plan with its id, its name and when it was saved, in the topic's order.
    const first = r.out.findIndex((l) => l.includes(PLAN_ID) && l.includes('Texas 18 Nov 09:40') && l.includes('2026-11-18'));
    const second = r.out.findIndex((l) => l.includes('texas-two-stop') && l.includes('Texas two-stop') && l.includes('2026-11-17'));
    expect(first, r.out.join('\n')).toBeGreaterThanOrEqual(0);
    expect(second, r.out.join('\n')).toBeGreaterThan(first);
    expect(bridge.actions()).toEqual([]);
  });

  it('pitwall plans open --qualifying … --practice … --laps 56 --sets fresh sends plans.round.open then plans.race.set', async () => {
    const bridge = await fakeBridge();
    const r = await pitwall(['plans', 'open', '--qualifying', QUALIFYING_TEXT, '--practice', PRACTICE_TEXT, '--laps', '56', '--sets', 'fresh'], bridge.port);
    expect(r.err).toBe('');
    expect(r.code).toBe(0);
    expect(bridge.actions()).toEqual<UiAction[]>([
      { kind: 'plans.round.open', feedId: FEED, team: 0, qualifying: QUALIFYING, practice: [PRACTICE] },
      { kind: 'plans.race.set', feedId: FEED, race: { laps: 56, sets: 'fresh', conditions: IMPORTED } },
    ]);
  });

  it('pitwall plans open takes the team from the stored qualifying, not the feed (C62d)', async () => {
    const bridge = await fakeBridge({}, storedFor(3)); // the hello's feed is team 0
    const r = await pitwall(['plans', 'open', '--qualifying', QUALIFYING_TEXT, '--practice', 'none'], bridge.port);
    expect(r.code).toBe(0);
    expect(bridge.actions()).toEqual([expect.objectContaining({ kind: 'plans.round.open', team: 3 })]);
  });

  it('pitwall plans open refuses a qualifying that is not stored', async () => {
    const bridge = await fakeBridge({}, { sessions: [] });
    const r = await pitwall(['plans', 'open', '--qualifying', QUALIFYING_TEXT], bridge.port);
    expect(r.code).toBe(1);
    expect(r.err).toContain('is not stored');
    expect(bridge.actions()).toEqual([]);
  });

  it('a rejection prints the bridge\'s message and exits 1', async () => {
    const refusal = `session ${QUALIFYING_TEXT} is not stored`;
    const bridge = await fakeBridge({ 'basis.choose': refusal });
    const r = await pitwall(['basis', 'choose', '--practice', 'none', '--qualifying', QUALIFYING_TEXT], bridge.port);
    expect(r.code).toBe(1);
    expect(r.err).toContain(refusal);
    expect(bridge.actions()).toEqual([expect.objectContaining({ kind: 'basis.choose', basis: { practice: [], qualifying: QUALIFYING } })]);
  });
});
