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
import { feedId, type CarId, type FeedId, type Policy, type SavedPlan, type StrategyCar, type StrategyOutput } from '@pitwall/domain';
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
const raceSet = (feed: FeedId, laps: number, sets: 'carried' | 'fresh' = 'carried') => ({ kind: 'plans.race.set', feedId: feed, race: { laps, sets } });

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
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false }));
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
      expect(b.prepared().at(-1), `session type ${s.type}`).toEqual({ open: false });
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
    await vi.waitFor(() => expect(b.preview(0).length).toBeGreaterThan(0), { timeout: 60_000 });
    expect(rowsOf(b, 0).map((r) => r.slot)).toEqual([null]);

    // the race assumptions re-run the job (C73: one uiAction, validated)
    const before = b.preview(0).length;
    expect(await b.send(raceSet(A, 44, 'fresh'))).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().race).toEqual({ laps: 44, sets: 'fresh' }));
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
    await vi.waitFor(() => expect(b.round().race).toEqual({ laps: 44, sets: 'carried' }));
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
    await rejected({ kind: 'plans.race.set', feedId: A, race: { laps: 44, sets: 'used' } });
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
      computedOn: { basis: { practice: [ref(69n)], qualifying: ref(70n) }, race: { laps: 44, sets: 'fresh' } },
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
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, running: true }), { timeout: 60_000 });

    // the race's first packet while the job runs: the round closes, the job is cancelled
    b.play(firstPackets({ uid: 76n, type: 15 }));
    await vi.waitFor(() => expect(b.prepared().at(-1)).toEqual({ open: false }));
    // past the time the job would have taken: its result is never published
    await new Promise((r) => setTimeout(r, SLOW_MS + 2000));
    expect(b.preview(0)).toEqual([]);
    expect(b.preview(1)).toEqual([]);
    expect(b.prepared().at(-1)).toEqual({ open: false });
    // and nothing plans any more
    expect(await b.send(raceSet(A, 45))).toEqual({ ok: false, reason: 'notSupported' });
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
    expect((await roundSettles(b)).race).toEqual({ laps: 44, sets: 'carried' });
  });
});
