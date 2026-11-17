// SP4.3d2 Task 10, the bridge's planning module (C1a, C47, C51, C54, C55, C58, C62, C62d, C70, C73, C75; SP4.3d spec
// §7.0 rules 3–6, §7.1, §7.4). Between a weekend's qualifying and its race the bridge holds a planning round per feed:
// it opens when the feed's session ends with `endsQualifying` (a Q3, a one-shot or short qualifying, a sprint shootout's
// last segment), for the race `raceFormatOf(format)` plans, the feed's team and weekend, and closes when the feed's next
// session starts (its job cancelled, its result dropped). `plans.prepare.*` uiActions edit the team's prepared plans
// (`PITWALL_DATA_DIR/plans/<weekendId>/<format>/<team>.json`); every accepted one writes the file, republishes
// `plans.prepared` and re-runs the planning job of every open round of the team, once race laps are entered; the job's
// result per our car is `plans.preview` (`Computed<StrategyCar>`).
//
// Seams this file assumes (the implement phase adds them):
//  - `serve`'s option `planningJob`: the planning job the planning module runs (default `PLANNING_JOB`, Task 9); these
//    tests pass a stand-in whose worker module echoes its input (`planning-stub-job.ts`: per our car one row per
//    prepared slot, the slot on the row) or does so after a wait (`planning-slow-stub-job.ts`). No test here needs the
//    real job: the model's rows are Task 9's tests; these check the trigger path, the topics and the store;
//  - `plans.prepared` publishes `{ open: false }` for a feed outside the round (from the feed's start on);
//  - the prepared cars are keyed by the qualifying session's car slot, each with its race number (C62).
//
// Every run is a live `serve` on manual sources (live-like) fed builder sessions, in a temporary data dir (C84: no test
// reads `PITWALL_DATA_DIR`); sessions end by Task 3's timer on the test's receive clock.
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { Computed, PlanningRound, ServerMessage } from '@pitwall/contracts';
import { feedId, type CarId, type FeedId, type Policy, type PreparedPlans, type StrategyCar, type StrategyOutput } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { SLOW_MS } from './planning-slow-stub-job.ts';

const A = feedId('udp-20777');
const B = feedId('udp-20778');
const RULES = 'unversioned';
const GRACE_MS = 10_000;
const TICK_MS = 5;
/** The weekend (its `weekendLinkIdentifier`) and the track of the sessions. */
const WEEKEND = 4321;
const TRACK = 10;
/** Six slots: 0 and 1 drive for team 3 (our cars: the player 0, the teammate 1), 2 and 3 for team 4, 4 and 5 for team 5. */
const TEAMS = [3, 3, 4, 4, 5, 5] as const;
const TEAM = 3;
/** The builder's race numbers: slot + 1. */
const RACE_NUMBER = (car: number): number => car + 1;
const car = (n: number): CarId => n as CarId;

/** A grand-prix weekend and a sprint weekend (session types: 1 P1, 5–7 Q1–Q3, 10–12 SQ1–SQ3, 15 race, 16 race 2). */
const GP_WEEKEND = [1, 5, 6, 7, 15];
const SPRINT_WEEKEND = [1, 10, 11, 12, 15, 5, 6, 7, 16];

type SessionSpec = { uid: bigint; type: number; structure?: readonly number[]; weekend?: number; track?: number; laps?: number; player?: number };
type Packets = ReturnType<ScenarioBuilder['packets']>;

/** A short builder session of six cars that ends with SEND. */
const sessionPackets = (s: SessionSpec): Packets => {
  const structure = s.structure ?? GP_WEEKEND;
  return new ScenarioBuilder({ sessionUid: s.uid, cars: TEAMS.length, player: s.player ?? 0 })
    .session({
      sessionType: s.type, weekendStructure: [...structure], numSessionsInWeekend: structure.length,
      weekendLinkIdentifier: s.weekend ?? WEEKEND, trackId: s.track ?? TRACK, totalLaps: s.laps ?? 10,
    })
    .participants({ participants: TEAMS.map((teamId) => ({ teamId })) })
    .frames(30, () => {})
    .event({ code: 'SEND' })
    .packets();
};

/** The first frame's packets of a session (the race loading). */
const firstPackets = (s: SessionSpec): Packets => {
  const all = sessionPackets(s);
  return all.filter((p) => p.packet.header.frameIdentifier === 0);
};

const job = (module: string): Job<StrategyInput, StrategyOutput> => ({
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning module builds the input itself (planningInputFrom)');
  },
  module: new URL(module, import.meta.url),
});
const ECHO_JOB = job('./planning-stub-job.ts');
const SLOW_JOB = job('./planning-slow-stub-job.ts');

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `planning-round-${name}-`));
const preparedFile = (dataDir: string, format: string, team = TEAM): string => join(dataDir, 'plans', String(WEEKEND), format, `${team}.json`);
const readPrepared = (path: string): PreparedPlans => JSON.parse(readFileSync(path, 'utf8')) as PreparedPlans;

type Answer = { ok: true } | { ok: false; reason: string; message?: string };

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

/**
 * A live `serve` with one manual source per feed in `feeds`, on the data dir `dataDir` (a new temporary one by default),
 * its stale timer on the test's receive clock, the planning job `planningJob`, and a WebSocket client subscribed per
 * feed to `plans.prepared` and to `plans.preview` of cars 0 and 1.
 */
async function bridge(o: { dataDir?: string; feeds?: readonly FeedId[]; planningJob?: Job<StrategyInput, StrategyOutput> } = {}) {
  const dataDir = o.dataDir ?? tmp('data');
  const uiDir = join(dataDir, 'ui');
  const recordingsDir = join(dataDir, 'recordings');
  for (const dir of [uiDir, recordingsDir]) mkdirSync(dir, { recursive: true });
  const db: Db = openDatabase(join(dataDir, 'live.db'));
  const feeds = o.feeds ?? [A];
  const sources = new Map(feeds.map((id) => [id, new ManualSource(id)] as const));
  let now = 0;
  const out: string[] = [];
  const abort = new AbortController();
  const done = serve({
    sources: [...sources.values()].map((source) => ({ source, feed: { kind: 'udp' as const, label: source.feedId } })),
    wsPort: 0,
    dumpsDir: join(dataDir, 'dumps'),
    uiDir,
    storage: { db, recordingsDir, rulesVersion: RULES },
    staleCheck: { clock: () => now, everyMs: TICK_MS },
    planningJob: o.planningJob ?? ECHO_JOB,
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
  for (const id of feeds) {
    ws.send(JSON.stringify({ type: 'subscribe', id: `prepared:${id}`, topic: 'plans.prepared', params: {}, feedId: id }));
    for (const c of [0, 1]) ws.send(JSON.stringify({ type: 'subscribe', id: `preview:${id}:${c}`, topic: 'plans.preview', params: { carId: c }, feedId: id }));
  }
  const values = <T>(id: string): T[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === id && 'value' in m ? [m.value as T] : []));
  /** Every `plans.prepared` value of `feed`, in order. */
  const prepared = (feed: FeedId = A): PlanningRound[] => values<PlanningRound>(`prepared:${feed}`);
  /** Every `plans.preview` value of `feed`'s car `c`, in order. */
  const preview = (c: number, feed: FeedId = A): Array<Computed<StrategyCar>> => values<Computed<StrategyCar>>(`preview:${feed}:${c}`);
  /** The newest open round of `feed`. */
  const round = (feed: FeedId = A): Extract<PlanningRound, { open: true }> => {
    const last = prepared(feed).at(-1);
    if (last?.open !== true) throw new Error(`feed ${feed}: no open round (${JSON.stringify(last)})`);
    return last;
  };
  let actions = 0;
  /** Sends a uiAction; its answer, or `malformed` when the decoder refused it (C73). */
  const send = async (action: Record<string, unknown>): Promise<Answer> => {
    const id = `a${actions++}`;
    const malformedBefore = got.filter((m) => m.type === 'error' && 'reason' in m && m.reason === 'malformed').length;
    ws.send(JSON.stringify({ type: 'uiAction', id, action }));
    return vi.waitFor(() => {
      const answer = got.find((m) => m.type === 'actionResult' && m.id === id);
      if (answer !== undefined) {
        const { type: _type, id: _id, ...rest } = answer as unknown as { type: string; id: string } & Answer;
        return rest as Answer;
      }
      const malformed = got.filter((m) => m.type === 'error' && 'reason' in m && m.reason === 'malformed').length;
      if (malformed > malformedBefore) return { ok: false, reason: 'malformed' } as const;
      throw new Error(`no answer to ${id}`);
    });
  };
  /** `packets` reach `feed`'s source on the receive clock, the first one a second after the clock's present. */
  const play = (packets: Packets, feed: FeedId = A): void => {
    const source = sources.get(feed)!;
    const base = now + 1000 - packets[0]!.receivedAtMs;
    for (const { packet, receivedAtMs } of packets) {
      now = Math.max(now, base + receivedAtMs);
      source.push(packetBytes(packet), now);
    }
  };
  const completeSessions = (): number => (db.prepare('SELECT count(*) FROM sessions WHERE complete = 1').pluck().get() as number);
  /** Silence past the SEND grace window: the timer ends the sessions played; waits until `count` sessions are stored complete. */
  const ended = async (count: number): Promise<void> => {
    now += GRACE_MS + 1000;
    await vi.waitFor(() => expect(completeSessions()).toBe(count), { timeout: 10_000 });
  };
  return { dataDir, send, prepared, preview, round, play, ended, stop };
}

type Bridge = Awaited<ReturnType<typeof bridge>>;

/** A grand prix's Q3 of feed `feed`'s player car `player`, played and ended by the timer; `count` sessions stored complete after it. */
async function q3(b: Bridge, count = 1, uid = 70n): Promise<void> {
  b.play(sessionPackets({ uid, type: 7 }));
  await b.ended(count);
}

const POLICY_A: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };
const POLICY_B: Policy = { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }] };
const save = (feed: FeedId, c: number, slot: string, policy: Policy) => ({ kind: 'plans.prepare.save', feedId: feed, carId: c, slot, policy });

/** The rows of the newest preview of `feed`'s car `c` (known). */
const rowsOf = (b: Bridge, c: number, feed: FeedId = A) => {
  const value = b.preview(c, feed).at(-1)?.value;
  if (value === undefined || !value.known) throw new Error(`feed ${feed} car ${c}: no known preview`);
  return value.value.rows;
};

describe('the planning round (Task 10; C62d, C54, C55)', { timeout: 120_000 }, () => {
  it('opens', async () => {
    const b = await bridge();
    // before the qualifying ends: no round
    b.play(sessionPackets({ uid: 70n, type: 7 }));
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false }));
    await b.ended(1);
    await vi.waitFor(() => expect(b.prepared().at(-1)?.open).toBe(true));
    expect(b.round()).toEqual({
      open: true,
      weekendId: String(WEEKEND),
      format: 'grandPrix',
      team: TEAM,
      laps: { entered: null, suggested: { known: false, reason: 'notReceived' } },
      // both our cars, by the qualifying session's slot, each with its race number (C62)
      cars: {
        0: { raceNumber: RACE_NUMBER(0), slots: {}, active: null },
        1: { raceNumber: RACE_NUMBER(1), slots: {}, active: null },
      },
      running: false,
    });
  });

  it('opens (session.end)', async () => {
    const b = await bridge();
    // the engineer ends the recording before the grace window passed (C59): the round opens the same
    b.play(sessionPackets({ uid: 71n, type: 7 }));
    expect(await b.send({ kind: 'session.end', feedId: A })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared().at(-1)?.open).toBe(true));
    expect(b.round()).toMatchObject({ weekendId: String(WEEKEND), format: 'grandPrix', team: TEAM });
  });

  it('paths', async () => {
    const b = await bridge();
    // a sprint weekend: the shootout plans the sprint (spec §7.0 rules 5, 6)
    b.play(sessionPackets({ uid: 80n, type: 12, structure: SPRINT_WEEKEND }));
    await b.ended(1);
    await vi.waitFor(() => expect(b.round().format).toBe('sprint'));
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 19 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(existsSync(preparedFile(b.dataDir, 'sprint'))).toBe(true));
    expect(readPrepared(preparedFile(b.dataDir, 'sprint')).laps).toBe(19);
    expect(existsSync(preparedFile(b.dataDir, 'grandPrix'))).toBe(false);

    // the weekend's qualifying plans the grand prix: its own file, the sprint's untouched
    b.play(sessionPackets({ uid: 81n, type: 7, structure: SPRINT_WEEKEND }));
    await b.ended(2);
    await vi.waitFor(() => expect(b.round().format).toBe('grandPrix'));
    // a round of another race starts with nothing entered
    expect(b.round().laps.entered).toBeNull();
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(existsSync(preparedFile(b.dataDir, 'grandPrix'))).toBe(true));
    expect(readPrepared(preparedFile(b.dataDir, 'grandPrix')).laps).toBe(44);
    expect(readPrepared(preparedFile(b.dataDir, 'sprint')).laps).toBe(19);
  });

  it('no round', async () => {
    const b = await bridge();
    const sessions: SessionSpec[] = [
      { uid: 90n, type: 5 }, // Q1
      { uid: 91n, type: 6 }, // Q2
      { uid: 92n, type: 15 }, // the race
      { uid: 93n, type: 1 }, // practice
      { uid: 94n, type: 10, structure: SPRINT_WEEKEND }, // the shootout's first segment
    ];
    let count = 0;
    for (const s of sessions) {
      b.play(sessionPackets(s));
      await b.ended(++count);
      // the timer ran past the end; the round would have opened by now
      await new Promise((r) => setTimeout(r, 200));
      expect(b.prepared().at(-1), `session type ${s.type}`).toEqual({ open: false });
      expect(b.prepared().some((v) => v.open), `session type ${s.type}`).toBe(false);
    }
    // without an open round every planning action is not supported (no session to plan from)
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: false, reason: 'notSupported' });
    expect(await b.send(save(A, 0, 'A', POLICY_A))).toEqual({ ok: false, reason: 'notSupported' });
    expect(existsSync(join(b.dataDir, 'plans'))).toBe(false);
  });

  it('edits', async () => {
    const dataDir = tmp('data');
    const b = await bridge({ dataDir });
    await q3(b);
    await vi.waitFor(() => expect(b.round().open).toBe(true));
    // without entered laps no job runs
    await new Promise((r) => setTimeout(r, 1500));
    expect(b.preview(0)).toEqual([]);

    // the laps run the job: a preview per our car
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().laps.entered).toBe(44));
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(0), { timeout: 20_000 });
    await vi.waitFor(() => expect(b.preview(1).length).toBeGreaterThan(0), { timeout: 20_000 });
    expect(rowsOf(b, 0).map((r) => r.slot)).toEqual([null]);

    // a save re-runs it: the preview's rows carry the saved slot
    expect(await b.send(save(A, 0, 'A', POLICY_A))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: null }));
    await vi.waitFor(() => expect(rowsOf(b, 0)).toEqual([expect.objectContaining({ slot: 'A', policy: POLICY_A })]), { timeout: 20_000 });
    // the job ran with the entered laps and is done
    await vi.waitFor(() => expect(b.round().running).toBe(false));

    // the file holds it (bridge user state, C70)
    const file = preparedFile(dataDir, 'grandPrix');
    expect(readPrepared(file)).toEqual({
      laps: 44,
      cars: expect.arrayContaining([
        { raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: null },
        { raceNumber: RACE_NUMBER(1), slots: {}, active: null },
      ]),
    });
    await b.stop();
    expect(readPrepared(file)).toMatchObject({ laps: 44, cars: expect.arrayContaining([expect.objectContaining({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A } })]) });

    // after a bridge restart, the next attempt at the qualifying opens on what was prepared
    const again = await bridge({ dataDir });
    again.play(sessionPackets({ uid: 72n, type: 7 }));
    await again.ended(2);
    await vi.waitFor(() => expect(again.prepared().at(-1)?.open).toBe(true));
    expect(again.round().laps.entered).toBe(44);
    expect(again.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: null });
    await vi.waitFor(() => expect(rowsOf(again, 0)).toEqual([expect.objectContaining({ slot: 'A', policy: POLICY_A })]), { timeout: 20_000 });
  });

  it('checks', async () => {
    const b = await bridge();
    await q3(b);
    await vi.waitFor(() => expect(b.round().open).toBe(true));
    const file = preparedFile(b.dataDir, 'grandPrix');
    const rejected = async (action: Record<string, unknown>): Promise<void> => {
      const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
      const round = b.round();
      const answer = await b.send(action);
      expect(answer.ok, JSON.stringify(action)).toBe(false);
      if (!answer.ok) expect(['invalid', 'malformed'], JSON.stringify(action)).toContain(answer.reason);
      // nothing written, nothing changed
      expect(existsSync(file) ? readFileSync(file, 'utf8') : undefined).toBe(before);
      expect(b.round()).toEqual(round);
    };

    // laps a whole number from 1 to 100
    await rejected({ kind: 'plans.prepare.laps', feedId: A, laps: 0 });
    await rejected({ kind: 'plans.prepare.laps', feedId: A, laps: 101 });
    await rejected({ kind: 'plans.prepare.laps', feedId: A, laps: 44.5 });
    expect(existsSync(file)).toBe(false);
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().laps.entered).toBe(44));

    // stop laps from 1 to laps − 1
    await rejected(save(A, 0, 'A', { startCompound: 'medium', stops: [{ lap: 44, compound: 'hard' }] }));
    await rejected(save(A, 0, 'A', { startCompound: 'medium', stops: [{ lap: 0, compound: 'hard' }] }));
    await rejected({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: { startCompound: 'medium', stops: [{ lap: 44, compound: 'hard' }] } });
    // slots and compounds from their closed lists
    await rejected(save(A, 0, 'X', POLICY_A));
    await rejected(save(A, 0, 'A', { startCompound: 'medium', stops: [{ lap: 20, compound: 'ultra' as never }] }));
    // a start compound is required on save and accept
    await rejected(save(A, 0, 'A', { stops: [{ lap: 20, compound: 'hard' }] }));
    await rejected({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: { stops: [{ lap: 20, compound: 'hard' }] } });
    // activating an empty slot
    await rejected({ kind: 'plans.prepare.activate', feedId: A, carId: 0, slot: 'B' });
    // a car that is none of ours
    await rejected(save(A, 2, 'A', POLICY_A));

    // removing the active slot
    expect(await b.send({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: POLICY_A })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: 'A' }));
    await rejected({ kind: 'plans.prepare.remove', feedId: A, carId: 0, slot: 'A' });
    // the accepted ones are what the file holds
    expect(readPrepared(file)).toEqual({
      laps: 44,
      cars: expect.arrayContaining([{ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: 'A' }]),
    });
    // an inactive slot can be removed, the active one changed
    expect(await b.send(save(A, 0, 'B', POLICY_B))).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.prepare.activate', feedId: A, carId: 0, slot: 'B' })).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.prepare.remove', feedId: A, carId: 0, slot: 'A' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { B: POLICY_B }, active: 'B' }));
    expect(readPrepared(file).cars).toEqual(expect.arrayContaining([{ raceNumber: RACE_NUMBER(0), slots: { B: POLICY_B }, active: 'B' }]));
  });

  it('team', async () => {
    // two feeds of one session whose player cars (0 and 1) drive for one team (C1a)
    const b = await bridge({ feeds: [A, B] });
    b.play(sessionPackets({ uid: 75n, type: 7, player: 0 }), A);
    b.play(sessionPackets({ uid: 75n, type: 7, player: 1 }), B);
    await b.ended(2);
    await vi.waitFor(() => expect(b.prepared(A).at(-1)?.open).toBe(true));
    await vi.waitFor(() => expect(b.prepared(B).at(-1)?.open).toBe(true));
    expect(b.round(B)).toMatchObject({ weekendId: String(WEEKEND), format: 'grandPrix', team: TEAM });

    // the laps entered on one feed are the team's: both feeds' jobs run
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round(B).laps.entered).toBe(44));
    await vi.waitFor(() => expect(b.preview(1, B).length).toBeGreaterThan(0), { timeout: 20_000 });
    expect(rowsOf(b, 1, B).map((r) => r.slot)).toEqual([null]);

    // an edit for car 1 on feed A re-runs the job of the teammate's feed too
    expect(await b.send(save(A, 1, 'A', POLICY_B))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round(B).cars[car(1)]).toEqual({ raceNumber: RACE_NUMBER(1), slots: { A: POLICY_B }, active: null }));
    await vi.waitFor(() => expect(rowsOf(b, 1, B)).toEqual([expect.objectContaining({ slot: 'A', policy: POLICY_B })]), { timeout: 20_000 });
    await vi.waitFor(() => expect(rowsOf(b, 1, A)).toEqual([expect.objectContaining({ slot: 'A', policy: POLICY_B })]), { timeout: 20_000 });
    // one file for the team
    expect(readPrepared(preparedFile(b.dataDir, 'grandPrix')).cars).toEqual(expect.arrayContaining([{ raceNumber: RACE_NUMBER(1), slots: { A: POLICY_B }, active: null }]));
  });

  it('race loads', async () => {
    const b = await bridge({ planningJob: SLOW_JOB });
    await q3(b);
    await vi.waitFor(() => expect(b.round().open).toBe(true));
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 44 })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().running).toBe(true));

    // the race's first packet while the job runs: the round closes, the job is cancelled
    b.play(firstPackets({ uid: 76n, type: 15 }));
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false }));
    // past the time the job would have taken: its result is never published
    await new Promise((r) => setTimeout(r, SLOW_MS + 2000));
    expect(b.preview(0)).toEqual([]);
    expect(b.preview(1)).toEqual([]);
    expect(b.prepared().at(-1)).toEqual({ open: false });
    // and nothing plans any more
    expect(await b.send({ kind: 'plans.prepare.laps', feedId: A, laps: 45 })).toEqual({ ok: false, reason: 'notSupported' });
  });

  it('suggestion', async () => {
    const b = await bridge();
    // a stored grand prix on the track, of 44 laps; then a newer race on another track, of 50
    b.play(sessionPackets({ uid: 60n, type: 15, weekend: 1111, laps: 44, structure: [15] }));
    await b.ended(1);
    b.play(sessionPackets({ uid: 61n, type: 15, weekend: 2222, track: TRACK + 1, laps: 50, structure: [15] }));
    await b.ended(2);
    await q3(b, 3);
    await vi.waitFor(() => expect(b.prepared().at(-1)?.open).toBe(true));
    expect(b.round().laps).toEqual({ entered: null, suggested: expect.objectContaining({ known: true, value: 44 }) });
  });

  it('suggestion (none)', async () => {
    const b = await bridge();
    // only a race on another track
    b.play(sessionPackets({ uid: 62n, type: 15, weekend: 2222, track: TRACK + 1, laps: 50, structure: [15] }));
    await b.ended(1);
    await q3(b, 2);
    await vi.waitFor(() => expect(b.prepared().at(-1)?.open).toBe(true));
    expect(b.round().laps).toEqual({ entered: null, suggested: { known: false, reason: 'notReceived' } });
  });
});
