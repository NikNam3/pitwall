// The bridge's planning round, through `serve` (C1a, C51, C54, C62d, C70, C73, C75; SP4.3e spec §4.3). Ported from the
// SP4.3d2 Task 10 tests to the planning runner (SP4.3e Task 7b): a round is a function of a qualifying recording, a
// practice basis and the race assumptions (`createPlanningRunner`, `planning-runner.test.ts`). At a qualifying's live
// end (`endsQualifying`: a Q3, a one-shot or short qualifying, a sprint shootout's last segment; the timer or
// `session.end`) the bridge opens the feed's round with that qualifying, its own basis's practice and the race
// assumptions `{ laps: suggested, sets: 'carried' }`; the feed's next session start closes it (its job cancelled, its
// result dropped). `plans.prepared` publishes `PlanningRoundState`; `plans.preview` the job's result per our car.
// `plans.race.set` changes the race assumptions (C73: validated; laps 1 to 100); `plans.prepare.*` the round's slots;
// `plans.save { name?, replaces? }` saves the round's slot choices as the team's saved plan (`plans/<team>/<id>.json`,
// with `computedOn`), and it becomes the team's last saved plan on the track (`basis/<team>.json`); `plans.rename` and
// `plans.delete` change a saved plan. Saved plans belong to the team (C1a). Deleted with the round per pipeline state:
// the prepared-plans file per race (`RaceKey`), `plans.prepare.laps` and the sprint/grand-prix keying.
//
// Seams this file assumes (the implement phase adds them):
//  - `serve`'s option `planningJob` as before (the echo stand-in `planning-stub-job.ts`, or its slow twin); `serve`
//    runs the round on its rebuild service (Task 7d) and its runner;
//  - `PlanningRoundState` exported by `@pitwall/contracts` (the topic's value, ruling R1);
//  - `createLastChoiceStore(dataDir, log)` (`src/pipeline/last-choice.ts`, Task 7a-1), read here only.
//
// Every run is a live `serve` on manual sources (live-like) fed builder sessions, in a temporary data dir (C84); sessions
// end by the timer on the test's receive clock.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { Computed, PlanningRoundState, ServerMessage } from '@pitwall/contracts';
import { feedId, IMPORTED, type CarId, type FeedId, type Policy, type SavedPlan, type StrategyCar, type StrategyOutput } from '@pitwall/domain';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { createLogger } from '../../src/log.ts';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
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
const ref = (uid: bigint, weekend = WEEKEND) => ({ sessionUid: uid.toString(), weekendId: String(weekend) });

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
const firstPackets = (s: SessionSpec): Packets => sessionPackets(s).filter((p) => p.packet.header.frameIdentifier === 0);

const job = (module: string): Job<StrategyInput, StrategyOutput> => ({
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning runner builds the input itself (planningInputFrom)');
  },
  module: new URL(module, import.meta.url),
});
const ECHO_JOB = job('./planning-stub-job.ts');
const SLOW_JOB = job('./planning-slow-stub-job.ts');

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `planning-round-${name}-`));
const plansDir = (dataDir: string, team = TEAM): string => join(dataDir, 'plans', String(team));
/** Every saved plan file of the team. */
const savedFiles = (dataDir: string, team = TEAM): SavedPlan[] =>
  existsSync(plansDir(dataDir, team))
    ? readdirSync(plansDir(dataDir, team)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(plansDir(dataDir, team), f), 'utf8')) as SavedPlan)
    : [];

type Answer = { ok: true } | { ok: false; reason: string; message?: string };
type Open = Extract<PlanningRoundState, { open: true }>;

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
  const prepared = (feed: FeedId = A): PlanningRoundState[] => values<PlanningRoundState>(`prepared:${feed}`);
  /** Every `plans.preview` value of `feed`'s car `c`, in order. */
  const preview = (c: number, feed: FeedId = A): Array<Computed<StrategyCar>> => values<Computed<StrategyCar>>(`preview:${feed}:${c}`);
  /** The newest open round of `feed`. */
  const round = (feed: FeedId = A): Open => {
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

/** A grand prix's Q3 of feed `feed`, played and ended by the timer; `count` sessions stored complete after it. */
async function q3(b: Bridge, count = 1, uid = 70n): Promise<void> {
  b.play(sessionPackets({ uid, type: 7 }));
  await b.ended(count);
}

/** Waits until `feed`'s round is open with its job done. */
const roundSettles = async (b: Bridge, feed: FeedId = A): Promise<Open> => {
  await vi.waitFor(() => expect(b.prepared(feed).at(-1)).toMatchObject({ open: true, running: false }), { timeout: 60_000 });
  return b.round(feed);
};

const POLICY_A: Policy = { startCompound: 'medium', stops: [{ lap: 20, compound: 'hard' }] };
const POLICY_B: Policy = { startCompound: 'soft', stops: [{ lap: 12, compound: 'medium' }, { lap: 30, compound: 'hard' }] };
const save = (feed: FeedId, c: number, slot: string, policy: Policy) => ({ kind: 'plans.prepare.save', feedId: feed, carId: c, slot, policy });
const raceSet = (feed: FeedId, laps: number, sets: 'carried' | 'fresh' = 'carried') => ({ kind: 'plans.race.set', feedId: feed, race: { laps, sets, conditions: IMPORTED } });

/** The rows of the newest preview of `feed`'s car `c` (known). */
const rowsOf = (b: Bridge, c: number, feed: FeedId = A) => {
  const value = b.preview(c, feed).at(-1)?.value;
  if (value === undefined || !value.known) throw new Error(`feed ${feed} car ${c}: no known preview`);
  return value.value.rows;
};

describe('the planning round (Task 7b, ported from SP4.3d2 Task 10; C62d, C54, C55)', { timeout: 180_000 }, () => {
  it('opens', async () => {
    const b = await bridge();
    // before the qualifying ends: no round
    b.play(sessionPackets({ uid: 70n, type: 7 }));
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] }));
    await b.ended(1);
    const round = await roundSettles(b);
    // the round of that qualifying, no practice stored, the sets carried over (its live end, spec §4.3)
    expect(round).toMatchObject({
      open: true,
      qualifying: ref(70n),
      practice: [],
      race: { sets: 'carried' },
      team: TEAM,
      // both our cars, by the qualifying session's slot, each with its race number (C62)
      cars: {
        0: { raceNumber: RACE_NUMBER(0), slots: {}, active: null },
        1: { raceNumber: RACE_NUMBER(1), slots: {}, active: null },
      },
      running: false,
      saved: [],
    });
    // no stored race suggests the laps: the round plans once they are entered (ruling R16)
    expect(round.race.laps).toBeNull();
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    // the planning job ran on it: a preview per our car
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(0), { timeout: 60_000 });
    await vi.waitFor(() => expect(b.preview(1).length).toBeGreaterThan(0), { timeout: 60_000 });
  });

  it('opens with its own basis\'s practice', async () => {
    const b = await bridge();
    // the weekend's practice of the seat, then its Q3: the round's practice basis is the qualifying's own basis's practice
    b.play(sessionPackets({ uid: 69n, type: 1 }));
    await b.ended(1);
    await q3(b, 2);
    const round = await roundSettles(b);
    expect(round.practice).toEqual([ref(69n)]);
    expect(round.qualifying).toEqual(ref(70n));
  });

  it('opens (session.end)', async () => {
    const b = await bridge();
    // the engineer ends the recording before the grace window passed (C59): the round opens the same
    b.play(sessionPackets({ uid: 71n, type: 7 }));
    expect(await b.send({ kind: 'session.end', feedId: A })).toEqual({ ok: true });
    const round = await roundSettles(b);
    expect(round).toMatchObject({ qualifying: ref(71n), team: TEAM, race: { sets: 'carried' } });
  });

  it('opens (a sprint shootout\'s last segment)', async () => {
    const b = await bridge();
    b.play(sessionPackets({ uid: 80n, type: 12, structure: SPRINT_WEEKEND }));
    await b.ended(1);
    expect(await roundSettles(b)).toMatchObject({ qualifying: ref(80n), team: TEAM });
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
      expect(b.prepared().at(-1), `session type ${s.type}`).toEqual({ open: false, saved: [] });
      expect(b.prepared().some((v) => v.open), `session type ${s.type}`).toBe(false);
    }
    // without an open round every round action is not supported (no round to plan in)
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: false, reason: 'notSupported' });
    expect(await b.send(save(A, 0, 'A', POLICY_A))).toEqual({ ok: false, reason: 'notSupported' });
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'none' })).toEqual({ ok: false, reason: 'notSupported' });
    expect(existsSync(join(b.dataDir, 'plans'))).toBe(false);
  });

  it('edits', async () => {
    const b = await bridge();
    await q3(b);
    await roundSettles(b);
    // no stored race suggests the laps: the round plans once they are entered (ruling R16)
    expect(await b.send(raceSet(A, 50))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(0), { timeout: 60_000 });
    expect(rowsOf(b, 0).map((r) => r.slot)).toEqual([null]);
    await vi.waitFor(() => expect(b.round().running).toBe(false), { timeout: 60_000 });

    // the race assumptions re-run the job (C73: one uiAction, validated)
    const before = b.preview(0).length;
    expect(await b.send(raceSet(A, 44, 'fresh'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().race).toEqual({ laps: 44, sets: 'fresh', conditions: IMPORTED }));
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(before), { timeout: 60_000 });

    // a slot save re-runs it: the preview's rows carry the saved slot
    expect(await b.send(save(A, 0, 'A', POLICY_A))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: null }));
    await vi.waitFor(() => expect(rowsOf(b, 0)).toEqual([expect.objectContaining({ slot: 'A', policy: POLICY_A })]), { timeout: 60_000 });
    await vi.waitFor(() => expect(b.round().running).toBe(false), { timeout: 60_000 });
    // the round's slots are no stored file of their own: only a saved plan is (C62d)
    expect(existsSync(join(b.dataDir, 'plans'))).toBe(false);
  });

  it('checks', async () => {
    const b = await bridge();
    await q3(b);
    await roundSettles(b);
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().race).toEqual({ laps: 44, sets: 'carried', conditions: IMPORTED }));
    await vi.waitFor(() => expect(b.round().running).toBe(false), { timeout: 60_000 });
    const rejected = async (action: Record<string, unknown>): Promise<void> => {
      const round = b.round();
      const answer = await b.send(action);
      expect(answer.ok, JSON.stringify(action)).toBe(false);
      if (!answer.ok) expect(['invalid', 'malformed'], JSON.stringify(action)).toContain(answer.reason);
      // nothing written, nothing changed
      expect(existsSync(join(b.dataDir, 'plans')), JSON.stringify(action)).toBe(false);
      expect(b.round()).toEqual(round);
    };

    // the race's laps a whole number from 1 to 100, its sets carried or fresh
    await rejected(raceSet(A, 0));
    await rejected(raceSet(A, 101));
    await rejected(raceSet(A, 44.5));
    await rejected({ kind: 'plans.race.set', feedId: A, race: { laps: 44, sets: 'used', conditions: IMPORTED } });
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
    // renaming or deleting a plan the team has not saved
    await rejected({ kind: 'plans.rename', feedId: A, id: 'none', name: 'x' });
    await rejected({ kind: 'plans.delete', feedId: A, id: 'none' });

    // removing the active slot
    expect(await b.send({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: POLICY_A })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: 'A' }));
    await vi.waitFor(() => expect(b.round().running).toBe(false), { timeout: 60_000 });
    await rejected({ kind: 'plans.prepare.remove', feedId: A, carId: 0, slot: 'A' });
    // an inactive slot can be removed, the active one changed
    expect(await b.send(save(A, 0, 'B', POLICY_B))).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.prepare.activate', feedId: A, carId: 0, slot: 'B' })).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.prepare.remove', feedId: A, carId: 0, slot: 'A' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(0)]).toEqual({ raceNumber: RACE_NUMBER(0), slots: { B: POLICY_B }, active: 'B' }));
  });

  it('(c) plans.save writes plans/<team>/<id>.json with computedOn; survives a restart', async () => {
    const dataDir = tmp('data');
    const b = await bridge({ dataDir });
    b.play(sessionPackets({ uid: 69n, type: 1 }));
    await b.ended(1);
    await q3(b, 2);
    await roundSettles(b);
    expect(await b.send(raceSet(A, 44, 'fresh'))).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: POLICY_A })).toEqual({ ok: true });
    expect(await b.send(save(A, 1, 'B', POLICY_B))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().cars[car(1)]).toMatchObject({ slots: { B: POLICY_B } }));

    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'Q3 plan' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toHaveLength(1));
    const [saved] = savedFiles(dataDir);
    // one file per plan, named by its id, of the team
    expect(existsSync(join(plansDir(dataDir), `${saved!.id}.json`))).toBe(true);
    expect(saved).toMatchObject({
      name: 'Q3 plan',
      team: TEAM,
      trackId: TRACK,
      // the basis and race assumptions it was computed on, for display only
      // the builder sessions carry no race samples: no effective conditions; the profile snapshot is the bridge's
      // profile store's (SP4.3f Task 3: its fingerprint), its value the store's
      computedOn: { basis: { practice: [ref(69n)], qualifying: ref(70n) }, race: { laps: 44, sets: 'fresh', conditions: IMPORTED }, forecast: [], profiles: expect.any(String) },
    });
    expect(typeof saved!.savedAt).toBe('string');
    // the round's slot choices per car, by race number (C62)
    expect(saved!.cars).toEqual(expect.arrayContaining([
      { raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A }, active: 'A' },
      { raceNumber: RACE_NUMBER(1), slots: { B: POLICY_B }, active: null },
    ]));
    // listed in the round's state, and the team's last saved plan on the track (C62d)
    await vi.waitFor(() => expect(b.round().saved).toEqual([{ id: saved!.id, name: 'Q3 plan', savedAt: saved!.savedAt }]));
    expect(createLastChoiceStore(dataDir, createLogger({ level: 'silent' })).read(TEAM, TRACK)?.plan.id).toBe(saved!.id);

    // replaces: the same plan, its new choices
    expect(await b.send({ kind: 'plans.prepare.activate', feedId: A, carId: 1, slot: 'B' })).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'Q3 plan', replaces: saved!.id })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([expect.objectContaining({
      id: saved!.id,
      cars: expect.arrayContaining([{ raceNumber: RACE_NUMBER(1), slots: { B: POLICY_B }, active: 'B' }]),
    })]));
    await b.stop();

    // a restart: the next round of the team on the track lists it
    const again = await bridge({ dataDir });
    again.play(sessionPackets({ uid: 72n, type: 7 }));
    await again.ended(3);
    const round = await roundSettles(again);
    expect(round.saved).toEqual([expect.objectContaining({ id: saved!.id, name: 'Q3 plan' })]);

    // rename and delete (C73)
    expect(await again.send({ kind: 'plans.rename', feedId: A, id: saved!.id, name: 'Texas final' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([expect.objectContaining({ id: saved!.id, name: 'Texas final' })]));
    await vi.waitFor(() => expect(again.round().saved).toEqual([expect.objectContaining({ id: saved!.id, name: 'Texas final' })]));
    expect(await again.send({ kind: 'plans.delete', feedId: A, id: saved!.id })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([]));
    await vi.waitFor(() => expect(again.round().saved).toEqual([]));
  });

  it('team', async () => {
    // two feeds of one session whose player cars (0 and 1) drive for one team (C1a)
    const b = await bridge({ feeds: [A, B] });
    b.play(sessionPackets({ uid: 75n, type: 7, player: 0 }), A);
    b.play(sessionPackets({ uid: 75n, type: 7, player: 1 }), B);
    await b.ended(2);
    await roundSettles(b, A);
    expect(await roundSettles(b, B)).toMatchObject({ qualifying: ref(75n), team: TEAM });
    // no stored race suggests the laps: each feed's round plans once they are entered (ruling R16)
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    expect(await b.send(raceSet(B, 44))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.preview(1, B).length).toBeGreaterThan(0), { timeout: 60_000 });

    // a plan saved on one feed is the team's: the teammate's round lists it (C1a)
    expect(await b.send({ kind: 'plans.prepare.accept', feedId: A, carId: 1, slot: 'A', policy: POLICY_B })).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'team plan' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round(B).saved).toEqual([expect.objectContaining({ name: 'team plan' })]));
    expect(savedFiles(b.dataDir)).toHaveLength(1);
  });

  it('race loads', async () => {
    const b = await bridge({ planningJob: SLOW_JOB });
    await q3(b);
    // no stored race suggests the laps: the round plans once they are entered (ruling R16)
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true }), { timeout: 60_000 });
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, running: true }), { timeout: 60_000 });

    // the race's first packet while the job runs: the round closes, the job is cancelled
    b.play(firstPackets({ uid: 76n, type: 15 }));
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] }));
    // past the time the job would have taken: its result is never published
    await new Promise((r) => setTimeout(r, SLOW_MS + 2000));
    expect(b.preview(0)).toEqual([]);
    expect(b.preview(1)).toEqual([]);
    expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] });
    // and nothing plans any more
    expect(await b.send(raceSet(A, 45))).toEqual({ ok: false, reason: 'notSupported' });
  });

  it('(F2) a save on feed A reaches feed B of the team without a round: its closed state lists the plan (C1a, C54)', async () => {
    const b = await bridge({ feeds: [A, B] });
    // feed B: a Q3 of the teammate's seat (car 1, team 3) opens B's round of team 3; B's next session (a practice on the
    // track) closes it: its closed state lists the saved plans of its last round's team (SP4.3f Task 3), none yet
    b.play(sessionPackets({ uid: 67n, type: 7, player: 1 }), B);
    await b.ended(1);
    await roundSettles(b, B);
    b.play(sessionPackets({ uid: 68n, type: 1, player: 1 }), B);
    await b.ended(2);
    await vi.waitFor(() => expect(b.prepared(B).at(-1)).toEqual({ open: false, saved: [] }));
    // feed A: a Q3 of the player's seat (car 0, team 3) opens A's round
    b.play(sessionPackets({ uid: 70n, type: 7, player: 0 }), A);
    await b.ended(3);
    await roundSettles(b, A);
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'team plan' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(b.dataDir)).toHaveLength(1));
    const [saved] = savedFiles(b.dataDir);
    // B has no round: its closed state is published again with the team's new saved list
    await vi.waitFor(() => expect(b.prepared(B).at(-1)).toEqual({ open: false, saved: [{ id: saved!.id, name: 'team plan', savedAt: saved!.savedAt }] }));

    // a rename and a delete on A reach B's closed state too
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: saved!.id, name: 'renamed' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared(B).at(-1)).toEqual({ open: false, saved: [expect.objectContaining({ id: saved!.id, name: 'renamed' })] }));
    expect(await b.send({ kind: 'plans.delete', feedId: A, id: saved!.id })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared(B).at(-1)).toEqual({ open: false, saved: [] }));
  });

  it('suggestion', async () => {
    const b = await bridge();
    // a stored grand prix on the track, of 44 laps; then a newer race on another track, of 50
    b.play(sessionPackets({ uid: 60n, type: 15, weekend: 1111, laps: 44, structure: [15] }));
    await b.ended(1);
    b.play(sessionPackets({ uid: 61n, type: 15, weekend: 2222, track: TRACK + 1, laps: 50, structure: [15] }));
    await b.ended(2);
    await q3(b, 3);
    // the round's laps default to the suggestion, its sets carried (its live end)
    expect((await roundSettles(b)).race).toEqual({ laps: 44, sets: 'carried', conditions: IMPORTED });
  });
});

// Task 7bfix F1, ported to SP4.3f Task 3 (C62d, C54, C70, C73; spec §4.2 "Team, last choice and saved plans"): the
// remembered feed seat (R19, `feeds/<feedId>.json`) is deleted with its tests (a running seat winning over the remembered
// one, a corrupt file; `no-remembered-seat.test.ts` pins that no file is read or written). The morning workflow of spec
// §1 stays: pitwall opened with no session running opens a round on `plans.round.open` from the picked qualifying, whose
// team owns the saved plans the round lists, renames and deletes. Before any round the feed has no team: its closed
// state lists no saved plans, and a rename or delete is rejected.
describe('between sessions: the team is the picked qualifying\'s (Task 7bfix F1, ported; C62d, C54, C70)', { timeout: 180_000 }, () => {
  it('(F1) a bridge started with no session opens a round on plans.round.open for the qualifying\'s team: its saved plans listed, renamed and deleted', async () => {
    const dataDir = tmp('data');
    const first = await bridge({ dataDir });
    // the weekend's practice and Q3 of the seat (car 0: team 3, race number 1)
    first.play(sessionPackets({ uid: 69n, type: 1 }));
    await first.ended(1);
    await q3(first, 2);
    await roundSettles(first);
    expect(await first.send(raceSet(A, 44))).toEqual({ ok: true });
    expect(await first.send({ kind: 'plans.prepare.accept', feedId: A, carId: 0, slot: 'A', policy: POLICY_A })).toEqual({ ok: true });
    expect(await first.send({ kind: 'plans.save', feedId: A, name: 'morning' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toHaveLength(1));
    const [saved] = savedFiles(dataDir);
    await first.stop();

    // the next morning: pitwall opened, no session running, no round opened yet: the feed has no team
    const b = await bridge({ dataDir });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] }));
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: saved!.id, name: 'x' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(savedFiles(dataDir)).toEqual([expect.objectContaining({ id: saved!.id, name: 'morning' })]);

    // the engineer picks the qualifying and practice to plan on: the round opens for the qualifying's team
    expect(await b.send({ kind: 'plans.round.open', feedId: A, team: TEAM, qualifying: ref(70n), practice: [ref(69n)] })).toEqual({ ok: true });
    const round = await roundSettles(b);
    expect(round).toMatchObject({
      qualifying: ref(70n),
      practice: [ref(69n)],
      team: TEAM,
      cars: { 0: { raceNumber: RACE_NUMBER(0) }, 1: { raceNumber: RACE_NUMBER(1) } },
      saved: [{ id: saved!.id, name: 'morning', savedAt: saved!.savedAt }],
    });
    expect(await b.send(raceSet(A, 44))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(0), { timeout: 60_000 });

    // rename: the round's team owns the plan (C73)
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: saved!.id, name: 'Texas final' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([expect.objectContaining({ id: saved!.id, name: 'Texas final' })]));
    await vi.waitFor(() => expect(b.round().saved).toEqual([expect.objectContaining({ id: saved!.id, name: 'Texas final' })]));

    // delete: the plan is gone from the round's list and from disk
    expect(await b.send({ kind: 'plans.delete', feedId: A, id: saved!.id })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([]));
    await vi.waitFor(() => expect(b.round().saved).toEqual([]));
  });

  it('(F1) rename and delete with no session: accepted for the round\'s team, rejected for another team\'s plan', async () => {
    const dataDir = tmp('data');
    const first = await bridge({ dataDir });
    // a Q3 of team 4's seat (car 2), its plan saved; then a Q3 of team 3's seat (car 0), its plan saved
    first.play(sessionPackets({ uid: 74n, type: 7, player: 2 }));
    await first.ended(1);
    await roundSettles(first);
    expect(await first.send(raceSet(A, 44))).toEqual({ ok: true });
    expect(await first.send({ kind: 'plans.save', feedId: A, name: 'team 4' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir, 4)).toHaveLength(1));
    first.play(sessionPackets({ uid: 70n, type: 7, player: 0 }));
    await first.ended(2);
    await vi.waitFor(() => expect(first.round()).toMatchObject({ qualifying: ref(70n), team: TEAM, running: false }), { timeout: 60_000 });
    expect(await first.send(raceSet(A, 44))).toEqual({ ok: true });
    expect(await first.send({ kind: 'plans.save', feedId: A, name: 'team 3' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toHaveLength(1));
    const [ours] = savedFiles(dataDir);
    const [theirs] = savedFiles(dataDir, 4);
    await first.stop();

    const b = await bridge({ dataDir });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false, saved: [] }));
    // the engineer opens team 3's round from its Q3: team 3's plans are the feed's
    expect(await b.send({ kind: 'plans.round.open', feedId: A, team: TEAM, qualifying: ref(70n), practice: [] })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, team: TEAM, saved: [expect.objectContaining({ id: ours!.id, name: 'team 3' })] }), { timeout: 60_000 });
    // another team's plan: rejected, nothing changed
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: theirs!.id, name: 'x' })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await b.send({ kind: 'plans.delete', feedId: A, id: theirs!.id })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(savedFiles(dataDir, 4)).toEqual([expect.objectContaining({ id: theirs!.id, name: 'team 4' })]);
    // the round's team's plan: accepted
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: ours!.id, name: 'renamed' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([expect.objectContaining({ id: ours!.id, name: 'renamed' })]));
    expect(await b.send({ kind: 'plans.delete', feedId: A, id: ours!.id })).toEqual({ ok: true });
    await vi.waitFor(() => expect(savedFiles(dataDir)).toEqual([]));
    await vi.waitFor(() => expect(b.round().saved).toEqual([]));
  });
});
