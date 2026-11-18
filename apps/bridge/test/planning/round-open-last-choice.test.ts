// SP4.3e Task 7g, ruling R23 (C62, C62d, C70; spec §4.2 "On confirm: … between sessions, the last confirmed choice is
// updated and the planning round runs on it"): `plans.round.open` (the picker's confirm between sessions, and `pitwall
// plans open`) on a feed whose team is known writes the team's last choice on the track (`basis/<team>.json`):
// `basis.practice = { refs: <the round's practice>, at: now }`, `basis.qualifying = { ref: <the round's qualifying>, at:
// now }`, the plan part unchanged; written when the round opens (the user's confirm), whether or not a replay runs or
// succeeds later. Nothing else changes: `plans.save` writes only the plan (Task 7b F3), and the round a qualifying's live
// end opens by itself is no confirm, so it writes no basis. The live case of 2026-11-18: a race in a new lobby (none of
// its own weekend's sessions stored) then preselects the confirmed practice and qualifying (rule `lastChoice`) and the
// saved plan, where it preselected none.
//
// Every run is a live `serve` (manual sources, live-like) on a temporary data dir (C84) fed builder sessions; sessions
// end by the timer on the test's receive clock. The last choice is read with `createLastChoiceStore` (Task 7a-1) as
// the bridge stores it.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { BasisActive, PlanningRoundState, ServerMessage } from '@pitwall/contracts';
import { feedId, type SavedPlan, type SessionBasis, type StrategyOutput } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { createLogger } from '../../src/log.ts';
import { recordingBasis } from '../../src/pipeline/basis-sidecar.ts';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const A = feedId('udp-20777');
const RULES = 'unversioned';
const GRACE_MS = 10_000;
const TICK_MS = 5;
/** The morning's weekend (its `weekendLinkIdentifier`) and the race's new lobby; both on the track. */
const WEEKEND = 4321;
const NEW_LOBBY = 9999;
const TRACK = 10;
/** Six slots: 0 and 1 drive for team 3 (the player 0, race number 1), 2 and 3 for team 4, 4 and 5 for team 5. */
const TEAMS = [3, 3, 4, 4, 5, 5] as const;
const TEAM = 3;
const ref = (uid: bigint, weekend = WEEKEND) => ({ sessionUid: uid.toString(), weekendId: String(weekend) });
/** The weekend's practice and its Q3, of the player's seat. */
const PRACTICE = 69n;
const QUALIFYING = 70n;
/** The race in the new lobby. */
const RACE = 80n;
const CONFIRMED: SessionBasis = { practice: [ref(PRACTICE)], qualifying: ref(QUALIFYING) };

const GP_WEEKEND = [1, 5, 6, 7, 15];

type SessionSpec = { uid: bigint; type: number; structure?: readonly number[]; weekend?: number };
type Packets = ReturnType<ScenarioBuilder['packets']>;

/** A short builder session of six cars on the track, the player in slot 0, that ends with SEND. */
const sessionPackets = (s: SessionSpec): Packets => {
  const structure = s.structure ?? GP_WEEKEND;
  return new ScenarioBuilder({ sessionUid: s.uid, cars: TEAMS.length, player: 0 })
    .session({
      sessionType: s.type, weekendStructure: [...structure], numSessionsInWeekend: structure.length,
      weekendLinkIdentifier: s.weekend ?? WEEKEND, trackId: TRACK, totalLaps: 10,
    })
    .participants({ participants: TEAMS.map((teamId) => ({ teamId })) })
    .frames(30, () => {})
    .event({ code: 'SEND' })
    .packets();
};

const ECHO_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning runner builds the input itself (planningInputFrom)');
  },
  module: new URL('./planning-stub-job.ts', import.meta.url),
};

const silent = createLogger({ level: 'silent' });
const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `round-open-last-choice-${name}-`));
const plansDir = (dataDir: string): string => join(dataDir, 'plans', String(TEAM));
/** Every saved plan file of the team. */
const savedFiles = (dataDir: string): SavedPlan[] =>
  existsSync(plansDir(dataDir))
    ? readdirSync(plansDir(dataDir)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(plansDir(dataDir), f), 'utf8')) as SavedPlan)
    : [];
/** The team's last choice on the track, as the bridge stores it. */
const lastChoice = (dataDir: string) => createLastChoiceStore(dataDir, silent).read(TEAM, TRACK);

type Answer = { ok: true } | { ok: false; reason: string; message?: string };

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/**
 * A live `serve` on feed A's manual source, on the data dir `dataDir`, its stale timer on the test's receive clock, and a
 * WebSocket client subscribed to `plans.prepared` and `basis.active` of feed A.
 */
async function bridge(dataDir: string) {
  const uiDir = join(dataDir, 'ui');
  const recordingsDir = join(dataDir, 'recordings');
  for (const dir of [uiDir, recordingsDir]) mkdirSync(dir, { recursive: true });
  const db: Db = openDatabase(join(dataDir, 'live.db'));
  const reader: Db = openDatabase(join(dataDir, 'live.db'));
  cleanup.push(() => reader.close());
  const source = new ManualSource(A);
  let now = 0;
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    sources: [{ source, feed: { kind: 'udp' as const, label: source.feedId } }],
    wsPort: 0,
    dumpsDir: join(dataDir, 'dumps'),
    uiDir,
    storage: { db, recordingsDir, rulesVersion: RULES },
    staleCheck: { clock: () => now, everyMs: TICK_MS },
    planningJob: ECHO_JOB,
    io: { out: (line) => out.push(line), err: () => {}, env: {}, signal: abort.signal },
  });
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    await done;
  };
  cleanup.push(stop);
  await vi.waitFor(() => expect(out.join('\n')).toMatch(/listening ws:\/\/127\.0\.0\.1:\d+/), { timeout: 15_000 });
  const port = /127\.0\.0\.1:(\d+)/.exec(out.join('\n'))![1];
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const got: ServerMessage[] = [];
  ws.on('message', (d) => got.push(JSON.parse(String(d)) as ServerMessage));
  await new Promise((r) => ws.once('open', r));
  cleanup.push(() => ws.terminate());
  ws.send(JSON.stringify({ type: 'subscribe', id: 'prepared', topic: 'plans.prepared', params: {}, feedId: A }));
  ws.send(JSON.stringify({ type: 'subscribe', id: 'active', topic: 'basis.active', params: {}, feedId: A }));
  const values = <T>(id: string): T[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value as T] : []));
  const prepared = (): PlanningRoundState[] => values<PlanningRoundState>('prepared');
  const active = (): BasisActive | undefined => values<BasisActive>('active').at(-1);
  let actions = 0;
  const send = async (action: Record<string, unknown>): Promise<Answer> => {
    const id = `a${actions++}`;
    ws.send(JSON.stringify({ type: 'uiAction', id, action }));
    return vi.waitFor(() => {
      const answer = got.find((m) => m.type === 'actionResult' && m.id === id);
      if (answer === undefined) throw new Error(`no answer to ${id}`);
      const { type: _type, id: _id, ...rest } = answer as unknown as { type: string; id: string } & Answer;
      return rest as Answer;
    });
  };
  /** `packets` on the source on the receive clock, the first one a second after the clock's present. */
  const play = (packets: Packets): void => {
    const base = now + 1000 - packets[0]!.receivedAtMs;
    for (const { packet, receivedAtMs } of packets) {
      now = Math.max(now, base + receivedAtMs);
      source.push(packetBytes(packet), now);
    }
  };
  const completeSessions = (): number => (reader.prepare('SELECT count(*) FROM sessions WHERE complete = 1').pluck().get() as number);
  /** Silence past the SEND grace window: the timer ends the sessions played; waits until `count` sessions are stored complete. */
  const ended = async (count: number): Promise<void> => {
    now += GRACE_MS + 1000;
    await vi.waitFor(() => expect(completeSessions()).toBe(count), { timeout: 10_000 });
  };
  /** The recording of session `uid` by the player car 0's run. */
  const recording = (uid: bigint): string => {
    const suffix = `_${uid.toString(16).padStart(16, '0')}_car00.pwrec.gz`;
    const files = readdirSync(recordingsDir, { recursive: true }).map(String).filter((f) => f.endsWith(suffix));
    expect(files, `the recording of ${uid}`).toHaveLength(1);
    return join(recordingsDir, files[0]!);
  };
  return { send, prepared, active, play, ended, recording, stop };
}

type Bridge = Awaited<ReturnType<typeof bridge>>;

const raceSet = (laps: number) => ({ kind: 'plans.race.set', feedId: A, race: { laps, sets: 'carried' } });
const roundOpen = { kind: 'plans.round.open', feedId: A, qualifying: ref(QUALIFYING), practice: [ref(PRACTICE)] };

/** Waits until feed A's round is open with its job done. */
const roundSettles = (b: Bridge): Promise<void> =>
  vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, running: false }), { timeout: 60_000 });

/**
 * The evening before: the weekend's practice and Q3 of the seat played; the round the Q3's end opens settles, and its
 * plan "evening" is saved (the team's last saved plan, no basis confirmed). Then the bridge stops, and the next morning
 * a bridge starts on the same data dir with no session running (the feed's seat remembered, R19). The data dir, the
 * morning's bridge and the evening's plan.
 */
async function morning(): Promise<{ dataDir: string; b: Bridge; evening: SavedPlan }> {
  const dataDir = tmp('data');
  const first = await bridge(dataDir);
  first.play(sessionPackets({ uid: PRACTICE, type: 1 }));
  await first.ended(1);
  first.play(sessionPackets({ uid: QUALIFYING, type: 7 }));
  await first.ended(2);
  await roundSettles(first);
  expect(await first.send(raceSet(44))).toEqual({ ok: true });
  expect(await first.send({ kind: 'plans.save', feedId: A, name: 'evening' })).toEqual({ ok: true });
  await vi.waitFor(() => expect(savedFiles(dataDir)).toHaveLength(1));
  const [evening] = savedFiles(dataDir);
  await first.stop();
  const b = await bridge(dataDir);
  await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [expect.objectContaining({ id: evening!.id })] }));
  return { dataDir, b, evening: evening! };
}

/** `at` is an ISO time from `from` to `to` (epoch ms). */
const expectTimeIn = (at: string | undefined, from: number, to: number, what: string): void => {
  expect(typeof at, what).toBe('string');
  const t = Date.parse(at!);
  expect(t, what).toBeGreaterThanOrEqual(from);
  expect(t, what).toBeLessThanOrEqual(to);
};

describe('opening a round writes the last confirmed choice (Task 7g, R23; C62, C62d, C70)', { timeout: 180_000 }, () => {
  it('(guard) the round a qualifying\'s live end opens by itself confirms no basis: the last choice holds only the saved plan', async () => {
    const { dataDir, evening } = await morning();
    const choice = lastChoice(dataDir);
    expect(choice?.plan).toEqual({ id: evening.id, at: evening.savedAt });
    expect(choice?.basis).toEqual({});
  });

  it('(a) plans.round.open with practice P and qualifying Q: basis/<team>.json holds both with a time, the plan part as before', async () => {
    const { dataDir, b, evening } = await morning();
    const before = Date.now();
    // the confirm between sessions; no race laps are known yet, so no replay runs: the choice is written all the same
    expect(await b.send(roundOpen)).toEqual({ ok: true });
    await vi.waitFor(() => expect(lastChoice(dataDir)?.basis.qualifying).toBeDefined());
    const after = Date.now();
    const choice = lastChoice(dataDir)!;
    expect(choice.trackId).toBe(TRACK);
    expect(choice.basis.practice?.refs).toEqual([ref(PRACTICE)]);
    expect(choice.basis.qualifying?.ref).toEqual(ref(QUALIFYING));
    expectTimeIn(choice.basis.practice?.at, before, after, 'practice confirmed at the open');
    expectTimeIn(choice.basis.qualifying?.at, before, after, 'qualifying confirmed at the open');
    // the plan part unchanged: the evening's saved plan
    expect(choice.plan).toEqual({ id: evening.id, at: evening.savedAt });
    // and the round opened on it
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, qualifying: ref(QUALIFYING), practice: [ref(PRACTICE)] }), { timeout: 60_000 });
  });

  it('(b) a following plans.save keeps the basis the open wrote and sets the plan', async () => {
    const { dataDir, b } = await morning();
    expect(await b.send(roundOpen)).toEqual({ ok: true });
    await vi.waitFor(() => expect(lastChoice(dataDir)?.basis.qualifying).toBeDefined());
    const opened = lastChoice(dataDir)!;
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true }), { timeout: 60_000 });
    expect(await b.send(raceSet(44))).toEqual({ ok: true });
    await roundSettles(b);
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'morning' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir).map((p) => p.name)).toContain('morning'));
    const saved = savedFiles(dataDir).find((p) => p.name === 'morning')!;
    const choice = lastChoice(dataDir)!;
    expect(choice.basis).toEqual(opened.basis);
    expect(choice.plan).toEqual({ id: saved.id, at: saved.savedAt });
  });

  it('(c) the next race in a new lobby (none of its own sessions stored) preselects P and Q (rule lastChoice) and the saved plan', async () => {
    const { dataDir, b } = await morning();
    expect(await b.send(roundOpen)).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true }), { timeout: 60_000 });
    expect(await b.send(raceSet(44))).toEqual({ ok: true });
    await roundSettles(b);
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'morning' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir).map((p) => p.name)).toContain('morning'));
    const saved = savedFiles(dataDir).find((p) => p.name === 'morning')!;

    // the race loads in a new lobby: another weekend, a race-only structure, on the track
    b.play(sessionPackets({ uid: RACE, type: 15, weekend: NEW_LOBBY, structure: [15] }));
    // the basis it starts with is the confirmed practice and qualifying, the plan the saved one (C62, C62d)
    await vi.waitFor(() => expect(b.active()?.plan?.id).toBe(saved.id), { timeout: 20_000 });
    const value = b.active()!;
    expect(value.start).toEqual(CONFIRMED);
    expect(value.basis).toEqual(CONFIRMED);
    expect(value.plan).toEqual({ id: saved.id, name: 'morning', laps: 44 });
    expect(value.lastChoice).toEqual({ basis: CONFIRMED, plan: saved.id });
    // the recording's basis sidecar: started on and preselected from the last choice
    const sidecar = recordingBasis(b.recording(RACE));
    expect(sidecar?.start).toEqual(CONFIRMED);
    expect(sidecar?.preselected).toEqual(CONFIRMED);
  });
});
