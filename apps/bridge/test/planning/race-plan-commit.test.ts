// SP4.3e Task 7b, row (e): choosing a saved plan in a race (C1a, C27a, C59, C62, C62d, C73, C76; spec §4.3 "Choosing a
// plan in a race"). Ported from the SP4.3d2 Task 11 race-start commit (its prepared-plans file per weekend, format and
// team is deleted with `RaceKey`): at a live race's (or sprint's) first frame with its weekend phase decided and the
// feed's team known, the team's first feed in the race reads the team's last chosen or saved plan on the track (the last
// choice, `basis/<team>.json`, naming a saved plan, `plans/<team>/<id>.json`) once and commits it as plan decisions
// (`planDecisionsOf`, by race number, C62: `planSaved` per slot in `PLAN_SLOTS` order, then `planCommitted` with the
// active slot) to every team feed then running (each engine's current frame, each decisions sidecar), without the lap
// range check; a feed that joins later is handed them through `TeamFeeds` (C76), never the plan again. "None" (no last
// choice, or a last choice naming no plan) commits nothing. A plan chosen later (`basis.choose { plan }`) commits its
// slots and removes the slots it lacks, on each of the team's feeds. A saved-plan edit changes nothing of a running race
// (C62d). `plan.accept` saves the slot and, when the car has no active plan, activates it, on the team's feeds, with
// `plan.save`'s range check (C73). After a bridge restart (C59, C76) a feed whose recording continued keeps its team's
// plan decisions as its projection holds them (a voided one not, C27a), so a teammate that joins later is handed them.
//
// Seams this file assumes (the implement phase adds them): `new SavedPlanStore(dataDir, log)` (`src/planning/saved-plans.ts`)
// and `createLastChoiceStore(dataDir, log)` (`src/pipeline/last-choice.ts`, Task 7a-1) write the team's plan and its last
// choice as the bridge reads them; `basis.choose` is routed by Task 7a-2 to `PlanChoice.choosePlan` (this task's). Every
// run is a live `serve` (manual sources, live-like) on a temporary data dir (C84); the logs are read from storage (the
// stored facts, the void facts applied as the projection applies them, C28) and from the recordings' decisions sidecars,
// their plan decisions only (a `basisChosen` is Task 7a-2's); sessions end by the timer on the test's receive clock. The
// segment pair is `qualifying-texas-send` then `race-texas-grid` (C84).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { BasisActive, PlanningRoundState, ServerMessage } from '@pitwall/contracts';
import {
  activeSlot, carId, feedId, latestPlan, NO_BASIS, PLAN_SLOTS, planSlots,
  type DecisionRecord, type FeedId, type GivenDecision, type Policy, type PreparedCar, type SavedPlan, type Slot, type StrategyOutput, type VoidFact,
} from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import type { StrategyInput } from '@pitwall/analysis';
import type { Job } from '@pitwall/engine/readers';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { serve } from '../../src/cli/serve.ts';
import { defineFeature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { createLastChoiceStore } from '../../src/pipeline/last-choice.ts';
import { SavedPlanStore } from '../../src/planning/saved-plans.ts';
import { TeamFeeds } from '../../src/pipeline/team-feeds.ts';
import { recordingBasis } from '../../src/pipeline/basis-sidecar.ts';
import { readPwrec } from '../../src/pwrec/reader.ts';
import { openDatabase, type Db } from '../../src/storage/db.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const A = feedId('udp-20777');
const B = feedId('udp-20778');
const RULES = 'unversioned';
const GRACE_MS = 10_000;
const TICK_MS = 5;
/** The weekend (its `weekendLinkIdentifier`) of the sessions. */
const WEEKEND = 4321;
/** Six slots: 0 and 1 drive for team 3 (our cars: the player 0, the teammate 1), 2 and 3 for team 4, 4 and 5 for team 5. */
const TEAMS = [3, 3, 4, 4, 5, 5] as const;
const TEAM = 3;
/** The builder's race numbers: slot + 1. */
const RACE_NUMBER = (car: number): number => car + 1;
/** The builder's race has 10 laps. */
const RACE_LAPS = 10;
/** Frames per lap of the builder races (16 ms a frame). */
const LAP_FRAMES = 100;

/** A grand-prix weekend and a sprint weekend (session types: 1 P1, 5–7 Q1–Q3, 10–12 SQ1–SQ3, 15 race, 16 race 2). */
const GP_WEEKEND = [1, 5, 6, 7, 15];
const SPRINT_WEEKEND = [1, 10, 11, 12, 15, 5, 6, 7, 16];

type Packets = ReturnType<ScenarioBuilder['packets']>;
type Participant = { teamId: number; raceNumber?: number };
type SessionSpec = {
  uid: bigint;
  type: number;
  structure?: readonly number[];
  player?: number;
  /** Every slot's team and race number (default: `TEAMS`, the builder's race numbers). */
  participants?: readonly Participant[];
  /** Frames before SEND (none without `send`). */
  frames?: number;
  /** The lap each frame is on (default: lap 1 + one per `LAP_FRAMES`). */
  lapOf?: (index: number) => number;
  /** Ends with SEND (default true). */
  send?: boolean;
  /** Events per frame index, sent with that frame. */
  events?: (index: number) => ReadonlyArray<Parameters<ScenarioBuilder['event']>[0]>;
  /** Frame indexes whose packets start with the Session and Participants again, as the game resends them. */
  resendAt?: readonly number[];
  /** The Participants packet's `numActiveCars` (default: every slot of `participants`). */
  numActiveCars?: number;
  /** Per slot, its LapData result status on every frame (the game's code: 1 inactive, 2 active, 7 retired; default 2). */
  resultStatusOf?: (car: number) => number;
};

const defaultLap = (index: number): number => 1 + Math.floor(index / LAP_FRAMES);

/** A builder session: every car on the lap `lapOf` names, ending with SEND unless `send: false`. */
const sessionPackets = (s: SessionSpec): Packets => {
  const structure = s.structure ?? GP_WEEKEND;
  const participants = s.participants ?? TEAMS.map((teamId) => ({ teamId }));
  const lapOf = s.lapOf ?? defaultLap;
  const session = {
    sessionType: s.type, weekendStructure: [...structure], numSessionsInWeekend: structure.length,
    weekendLinkIdentifier: WEEKEND, totalLaps: RACE_LAPS,
  };
  const participantsPacket = () => ({
    participants: participants.map((p) => ({ ...p })),
    ...(s.numActiveCars !== undefined && { numActiveCars: s.numActiveCars }),
  });
  const b = new ScenarioBuilder({ sessionUid: s.uid, cars: participants.length, player: s.player ?? 0 })
    .session(session)
    .participants(participantsPacket());
  const n = s.frames ?? 30;
  for (let i = 0; i < n; i++) {
    if (i > 0 && s.resendAt?.includes(i)) b.session(session).participants(participantsPacket());
    for (const details of s.events?.(i) ?? []) b.event(details);
    b.frame((f) => {
      const lap = lapOf(i);
      f.lapData.lapData.slice(0, participants.length).forEach((car, index) => {
        Object.assign(car, { currentLapNum: lap, lapDistance: ((i % LAP_FRAMES) * 50) + 10, totalDistance: i * 50 + 10 });
        if (s.resultStatusOf !== undefined) car.resultStatus = s.resultStatusOf(index);
      });
    });
  }
  if (s.send ?? true) b.event({ code: 'SEND' });
  return b.packets();
};

/**
 * What the game sends after a flashback: the forked timeline's packets from frame id `first` on, their
 * `overallFrameIdentifier` still rising after the undone timeline's `undoneFrames` frames.
 */
const afterFlashback = (fork: Packets, first: number, undoneFrames: number): Packets =>
  fork
    .filter(({ packet }) => packet.header.frameIdentifier >= first)
    .map(({ packet, receivedAtMs }) => ({
      receivedAtMs,
      packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: undoneFrames + packet.header.frameIdentifier - first } },
    }) as Packets[number]);

const tmp = (name: string): string => mkdtempSync(join(tmpdir(), `race-plan-commit-${name}-`));
const log = createLogger({ level: 'silent' });

/** The builder sessions' track (the builder's default `trackId`). */
const TRACK = 0;
const AT = '2026-11-18T09:40:00.000Z';

/** A saved plan of the team on the track with `cars`. */
const savedPlan = (id: string, cars: PreparedCar[]): SavedPlan => ({
  id,
  name: `plan ${id}`,
  team: TEAM,
  trackId: TRACK,
  savedAt: AT,
  computedOn: { basis: NO_BASIS, race: { laps: RACE_LAPS, sets: 'carried' } },
  cars,
});

/** Saves `plan` as the team's saved plan (`plans/<team>/<id>.json`), as the bridge stores it. */
const writePlan = (dataDir: string, plan: SavedPlan): void => new SavedPlanStore(dataDir, log).save(plan);

/** The team's last choice on the track names `planId` (`null`: none), as the bridge stores it (`basis/<team>.json`). */
const writeLastChoice = (dataDir: string, planId: string | null): void =>
  createLastChoiceStore(dataDir, log).write(TEAM, {
    trackId: TRACK,
    basis: { practice: { refs: [], at: AT }, qualifying: { ref: null, at: AT } },
    plan: { id: planId, at: AT },
  });

/** `plan` saved and chosen last: the plan a race on the track commits at its start. */
const choosePlan = (dataDir: string, plan: SavedPlan): void => {
  writePlan(dataDir, plan);
  writeLastChoice(dataDir, plan.id);
};

const POLICY_A: Policy = { startCompound: 'medium', stops: [{ lap: 5, compound: 'hard' }] };
const POLICY_B: Policy = { startCompound: 'soft', stops: [{ lap: 3, compound: 'medium' }, { lap: 7, compound: 'hard' }] };
/** The game's plan: a stop past the race's 10 laps; the commit skips the lap range check (§7.0 rule 7, §7.1 step 8). */
const POLICY_G1: Policy = { startCompound: 'hard', stops: [{ lap: 12, compound: 'medium' }] };
const POLICY_C: Policy = { startCompound: 'medium', stops: [{ lap: 4, compound: 'soft' }] };
const POLICY_X: Policy = { startCompound: 'soft', stops: [{ lap: 2, compound: 'hard' }] };

/** Car 0 (race number 1): A, B and G1, A active; car 1 (race number 2): C active. */
const PREPARED = savedPlan('morning', [
  { raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A, B: POLICY_B, G1: POLICY_G1 }, active: 'A' },
  { raceNumber: RACE_NUMBER(1), slots: { C: POLICY_C }, active: 'C' },
]);

/** The decisions the commit makes for `prepared` on car `car`: its slots in `PLAN_SLOTS` order, then its active one. */
const committedFor = (car: number, prepared: PreparedCar): GivenDecision[] => [
  ...PLAN_SLOTS.flatMap((slot): GivenDecision[] => {
    const policy = prepared.slots[slot];
    return policy === undefined ? [] : [{ kind: 'planSaved', carId: carId(car), slot, policy }];
  }),
  ...(prepared.active === null ? [] : [{ kind: 'planCommitted', carId: carId(car), policy: prepared.slots[prepared.active]!, slot: prepared.active } as GivenDecision]),
];

/** A decision without the frame it describes. */
const given = ({ frame: _frame, ...rest }: DecisionRecord): GivenDecision => rest as GivenDecision;
const PLAN_KINDS: ReadonlySet<string> = new Set(['planSaved', 'planRemoved', 'planCommitted', 'planCleared']);
/** The plan decisions of `decisions` (a `basisChosen` is the basis routing's, Task 7a-2). */
const plansOnly = <D extends { kind: string }>(decisions: readonly D[]): D[] => decisions.filter((d) => PLAN_KINDS.has(d.kind));
const ofCar = (decisions: readonly GivenDecision[], car: number): GivenDecision[] => decisions.filter((d) => 'carId' in d && d.carId === car);

/** Asserts `decisions` are exactly `prepared`'s commit, per car in order (car `car` → its prepared car). */
const expectCommitted = (decisions: readonly GivenDecision[], cars: ReadonlyArray<readonly [car: number, prepared: PreparedCar]>, what: string): void => {
  for (const [car, prepared] of cars) expect(ofCar(decisions, car), `${what}: car ${car}`).toEqual(committedFor(car, prepared));
  expect(decisions, `${what}: nothing else`).toHaveLength(cars.reduce((n, [car, prepared]) => n + committedFor(car, prepared).length, 0));
};

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});

type Answer = { ok: true } | { ok: false; reason: string; message?: string };

/**
 * A live `serve` with one manual source per feed in `feeds`, on the data dir `dataDir` (a new temporary one by default)
 * with storage, its stale timer on the test's receive clock, and a WebSocket client subscribed per feed to
 * `plans.prepared`.
 */
async function bridge(o: { dataDir?: string; feeds?: readonly FeedId[] } = {}) {
  const dataDir = o.dataDir ?? tmp('data');
  const uiDir = join(dataDir, 'ui');
  const recordingsDir = join(dataDir, 'recordings');
  for (const dir of [uiDir, recordingsDir]) mkdirSync(dir, { recursive: true });
  const db: Db = openDatabase(join(dataDir, 'live.db'));
  // the test's own connection: `serve` closes its one when it stops, the logs are read after that too
  const reader: Db = openDatabase(join(dataDir, 'live.db'));
  cleanup.push(() => reader.close());
  const feeds = o.feeds ?? [A, B];
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
  for (const id of feeds) ws.send(JSON.stringify({ type: 'subscribe', id: `prepared:${id}`, topic: 'plans.prepared', params: {}, feedId: id }));
  for (const id of feeds) ws.send(JSON.stringify({ type: 'subscribe', id: `active:${id}`, topic: 'basis.active', params: {}, feedId: id }));
  /** Every `basis.active` of `feed` published so far, oldest first (Task 7e). */
  const actives = (feed: FeedId = A): BasisActive[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === `active:${feed}` && 'value' in m ? [m.value as BasisActive] : []));
  /** The newest `basis.active` of `feed`; `undefined` before any. */
  const active = (feed: FeedId = A): BasisActive | undefined => actives(feed).at(-1);
  const prepared = (feed: FeedId = A): PlanningRoundState[] =>
    got.flatMap((m) => ((m.type === 'snapshot' || m.type === 'update') && m.id === `prepared:${feed}` && 'value' in m ? [m.value as PlanningRoundState] : []));
  const round = (feed: FeedId = A): Extract<PlanningRoundState, { open: true }> => {
    const last = prepared(feed).at(-1);
    if (last?.open !== true) throw new Error(`feed ${feed}: no open round (${JSON.stringify(last)})`);
    return last;
  };
  let actions = 0;
  /** Sends a uiAction; its answer. */
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
  /**
   * A player of `packets` on `feed`'s source: `to(frame)` pushes them up to before frame id `frame` (`Infinity`: all),
   * on the receive clock, the first one a second after the clock's present when the player is made.
   */
  const player = (packets: Packets, feed: FeedId = A) => {
    const source = sources.get(feed)!;
    const base = now + 1000 - packets[0]!.receivedAtMs;
    let next = 0;
    return {
      to: (frame: number): void => {
        while (next < packets.length && packets[next]!.packet.header.frameIdentifier < frame) {
          const { packet, receivedAtMs } = packets[next++]!;
          now = Math.max(now, base + receivedAtMs);
          source.push(packetBytes(packet), now);
        }
      },
      rest: (): void => {
        while (next < packets.length) {
          const { packet, receivedAtMs } = packets[next++]!;
          now = Math.max(now, base + receivedAtMs);
          source.push(packetBytes(packet), now);
        }
      },
    };
  };
  /** Every packet of `packets`, in order, on `feed`'s source (see `player`). */
  const play = (packets: Packets, feed: FeedId = A): void => player(packets, feed).rest();
  /** Raw records (a segment) on `feed`'s source, a second after the clock's present. */
  const playRaw = (records: ReadonlyArray<{ bytes: Uint8Array; t: number }>, feed: FeedId = A): void => {
    const source = sources.get(feed)!;
    const base = now + 1000 - records[0]!.t;
    for (const { bytes, t } of records) {
      now = Math.max(now, base + t);
      source.push(bytes, now);
    }
  };
  const completeSessions = (): number => (reader.prepare('SELECT count(*) FROM sessions WHERE complete = 1').pluck().get() as number);
  /** Silence past the SEND grace window: the timer ends the sessions played; waits until `count` sessions are stored complete. */
  const ended = async (count: number): Promise<void> => {
    now += GRACE_MS + 1000;
    await vi.waitFor(() => expect(completeSessions()).toBe(count), { timeout: 10_000 });
  };
  /** Silence past the SEND grace window; waits until feed `playerCar`'s run of session `uid` is stored complete. */
  const endedSession = async (uid: bigint, playerCar: number): Promise<void> => {
    now += GRACE_MS + 1000;
    await vi.waitFor(() => expect(reader.prepare('SELECT complete FROM sessions WHERE session_uid = ? AND player_car = ?').pluck().get(uid.toString(), playerCar)).toBe(1), { timeout: 10_000 });
  };
  /** Whether feed `player`'s run of session `uid` is stored (its row). */
  const stored = (uid: bigint, playerCar: number): boolean =>
    reader.prepare('SELECT count(*) FROM sessions WHERE session_uid = ? AND player_car = ?').pluck().get(uid.toString(), playerCar) === 1;
  /**
   * The decisions of the stored log of session `uid` as feed `playerCar`'s run records it, as the projection shows them
   * (C28): a decision a void fact covers is left out.
   */
  const decisions = (uid: bigint, playerCar: number): DecisionRecord[] => {
    const rows = (list: string) => reader
      .prepare('SELECT seq, record FROM facts WHERE session_uid = ? AND player_car = ? AND list = ? ORDER BY seq')
      .all(uid.toString(), playerCar, list) as Array<{ seq: number; record: string }>;
    const voids = rows('voids').map((r) => JSON.parse(r.record) as VoidFact);
    const voided = (seq: number): boolean => voids.some((v) => v.ranges.decisions !== undefined && seq >= v.ranges.decisions[0] && seq < v.ranges.decisions[1]);
    return plansOnly(rows('decisions').filter((r) => !voided(r.seq)).map((r) => JSON.parse(r.record) as DecisionRecord));
  };
  /** The void facts of the stored log of session `uid` (feed `playerCar`'s run). */
  const voids = (uid: bigint, playerCar: number): VoidFact[] =>
    (reader.prepare("SELECT record FROM facts WHERE session_uid = ? AND player_car = ? AND list = 'voids' ORDER BY seq").all(uid.toString(), playerCar) as Array<{ record: string }>)
      .map((r) => JSON.parse(r.record) as VoidFact);
  /** The recording of session `uid` by feed `playerCar`'s run. */
  const recording = (uid: bigint, playerCar: number): string => {
    const suffix = `_${uid.toString(16).padStart(16, '0')}_car${String(playerCar).padStart(2, '0')}.pwrec.gz`;
    const files = readdirSync(recordingsDir, { recursive: true }).map(String).filter((f) => f.endsWith(suffix));
    expect(files, `the recording of ${uid} car ${playerCar}`).toHaveLength(1);
    return join(recordingsDir, files[0]!);
  };
  /** The decisions sidecar's decisions of that recording; none without a sidecar. */
  const sidecar = (uid: bigint, playerCar: number): GivenDecision[] => {
    const path = `${recording(uid, playerCar)}.decisions.json`;
    if (!existsSync(path)) return [];
    return plansOnly((JSON.parse(readFileSync(path, 'utf8')) as Array<{ decision: GivenDecision }>).map((e) => e.decision));
  };
  /** Whether the stored log of session `uid` (feed `playerCar`'s run) holds a lap `lap` of car `car`. */
  const lapStored = (uid: bigint, playerCar: number, car: number, lap: number): boolean =>
    (reader.prepare("SELECT record FROM facts WHERE session_uid = ? AND player_car = ? AND list = 'laps'").all(uid.toString(), playerCar) as Array<{ record: string }>)
      .some((r) => { const l = JSON.parse(r.record) as { carId: number; lapNumber: number }; return l.carId === car && l.lapNumber === lap; });
  return { dataDir, reader, send, prepared, round, active, actives, player, play, playRaw, ended, endedSession, stored, decisions, voids, recording, sidecar, lapStored, stop };
}

type Bridge = Awaited<ReturnType<typeof bridge>>;

/** The planning job stand-in of Task 10's tests (no test here reads its result). */
const ECHO_JOB: Job<StrategyInput, StrategyOutput> = {
  kind: 'job',
  id: 'planning',
  reads: [],
  trigger: 'frame',
  prepare: () => {
    throw new Error('the planning module builds the input itself (planningInputFrom)');
  },
  module: new URL('./planning-stub-job.ts', import.meta.url),
};

/** Replays a recording alone with its sidecars (C76) and gives the decisions of its projection at its last frame. */
async function replayDecisions(file: string, id: FeedId): Promise<DecisionRecord[]> {
  let last: DecisionRecord[] = [];
  const probe: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.decision-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      last = plansOnly(structuredClone([...(view.history as unknown as { decisions: readonly DecisionRecord[] }).decisions]));
      return last.length;
    },
  };
  const pipeline = new FeedPipeline({
    feedId: id,
    source: new PwrecSource({ feedId: id, path: file, mode: 'asFastAsPossible' }),
    hub: new TopicHub({ now: () => 0 }),
    features: [defineFeature({ name: 'decision-probe', calculators: [probe], topics: [] })],
    log,
    teams: new TeamFeeds(),
    recorded: recordingDecisions(file),
  });
  pipeline.start();
  await pipeline.done;
  return last;
}

/** Waits until session `uid`'s run on `playerCar` holds `n` decisions. */
const decisionsReach = async (b: Bridge, uid: bigint, playerCar: number, n: number): Promise<void> => {
  await vi.waitFor(() => expect(b.decisions(uid, playerCar)).toHaveLength(n), { timeout: 20_000 });
};

const RACE = 100n;
const CAR0: readonly [number, PreparedCar] = [0, PREPARED.cars[0]!];
const CAR1: readonly [number, PreparedCar] = [1, PREPARED.cars[1]!];
/** Car 0's A, B, G1 saved and A active; car 1's C saved and active. */
const COMMIT_COUNT = committedFor(...CAR0).length + committedFor(...CAR1).length;

describe('choosing a saved plan in a race (Task 7b row e, ported from SP4.3d2 Task 11; C62d, C76, C1a)', { timeout: 120_000 }, () => {
  it('(e) a race\'s first frame with team known commits the team\'s last chosen or saved plan on the track on each team feed', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, PREPARED);
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 120 }), A);
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 120, player: 1 }), B);
    // the race's first frames on both team feeds (player cars 0 and 1 of team 3)
    for (const at of [5, 10, 20, 40]) {
      a.to(at);
      bb.to(at);
    }
    await decisionsReach(b, RACE, 0, COMMIT_COUNT);
    await decisionsReach(b, RACE, 1, COMMIT_COUNT);

    // a saved-plan edit after the commit changes nothing of the running race (C62d, C75)
    writePlan(b.dataDir, savedPlan(PREPARED.id, [{ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_X }, active: 'A' }]));
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    for (const player of [0, 1]) {
      // each log holds A, B, G1 saved and A active (car 0), C saved and active (car 1); G1's stop past the race's laps too
      expectCommitted(b.decisions(RACE, player).map(given), [CAR0, CAR1], `feed of car ${player}: the log`);
      const decisions = b.decisions(RACE, player);
      expect(planSlots({ decisions }, carId(0))).toEqual({ A: POLICY_A, B: POLICY_B, G1: POLICY_G1 });
      expect(activeSlot({ decisions }, carId(0))).toBe('A');
      expect(latestPlan({ decisions }, carId(0))).toEqual(POLICY_A);
      // and each decisions sidecar the same, so each recording replays alone (C76)
      expectCommitted(b.sidecar(RACE, player), [CAR0, CAR1], `feed of car ${player}: the sidecar`);
    }
  });

  it('late feed', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, PREPARED);
    // feed A runs the race alone to lap 3: it commits
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 330 }), A);
    a.to(250);
    await decisionsReach(b, RACE, 0, COMMIT_COUNT);
    // the saved plan changes before the teammate's feed joins: a joining feed is handed the team's plan decisions, never the plan again
    writePlan(b.dataDir, savedPlan(PREPARED.id, [{ raceNumber: RACE_NUMBER(1), slots: { A: POLICY_X }, active: 'A' }]));

    // the teammate's feed joins at lap 3
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 60, player: 1, lapOf: () => 3 }), B);
    bb.to(30);
    await decisionsReach(b, RACE, 1, COMMIT_COUNT);
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    // handed the slots and the active plan of each car (C76), on one frame
    const joined = b.decisions(RACE, 1);
    expectCommitted(joined.map(given), [CAR0, CAR1], 'the joining feed');
    expect(new Set(joined.map((d) => d.frame)).size).toBe(1);
    expectCommitted(b.sidecar(RACE, 1), [CAR0, CAR1], 'the joining feed\'s sidecar');
    // A's log is unchanged by B joining
    expectCommitted(b.decisions(RACE, 0).map(given), [CAR0, CAR1], 'feed A');
  });

  it('slot moved', async () => {
    const b = await bridge({ feeds: [A] });
    // the plan was computed on a qualifying whose car 19 carried race number 20: it holds the cars by race number
    choosePlan(b.dataDir, savedPlan('moved', [
      { raceNumber: 20, slots: { A: POLICY_A }, active: 'A' },
      { raceNumber: 1, slots: { B: POLICY_B }, active: 'B' },
    ]));

    // the race: 8 cars; race number 20 drives car 7, race number 1 car 0
    const race: Participant[] = [
      { teamId: TEAM, raceNumber: 1 }, { teamId: 4, raceNumber: 2 }, { teamId: 4, raceNumber: 3 }, { teamId: 5, raceNumber: 4 },
      { teamId: 5, raceNumber: 5 }, { teamId: 6, raceNumber: 6 }, { teamId: 6, raceNumber: 7 }, { teamId: TEAM, raceNumber: 20 },
    ];
    b.play(sessionPackets({ uid: RACE, type: 15, participants: race, frames: 60 }));
    await b.ended(1);
    await b.stop();

    // committed by race number (C62): race number 20's plan to car 7, none to slot 19
    const decisions = b.decisions(RACE, 0).map(given);
    expectCommitted(decisions, [
      [7, { raceNumber: 20, slots: { A: POLICY_A }, active: 'A' }],
      [0, { raceNumber: 1, slots: { B: POLICY_B }, active: 'B' }],
    ], 'the race');
    expect(ofCar(decisions, 19)).toEqual([]);
  });

  it('missing car', async () => {
    const b = await bridge({ feeds: [A] });
    // race number 99 drives in no slot of the race
    choosePlan(b.dataDir, savedPlan('missing', [PREPARED.cars[0]!, { raceNumber: 99, slots: { A: POLICY_X, B: POLICY_C }, active: 'B' }]));
    b.play(sessionPackets({ uid: RACE, type: 15, frames: 60 }));
    await b.ended(1);
    await b.stop();

    // car 0 is committed; race number 99 is skipped, nothing for any other car
    expectCommitted(b.decisions(RACE, 0).map(given), [CAR0], 'the log');
    expectCommitted(b.sidecar(RACE, 0), [CAR0], 'the sidecar');
  });

  it('sprint', async () => {
    const b = await bridge({ feeds: [A] });
    const sprint = savedPlan('sprint', [{ raceNumber: RACE_NUMBER(0), slots: { A: POLICY_B }, active: 'A' }]);
    const grandPrix = savedPlan('grand-prix', [{ raceNumber: RACE_NUMBER(0), slots: { B: POLICY_A, C: POLICY_C }, active: 'C' }]);
    writePlan(b.dataDir, grandPrix);
    choosePlan(b.dataDir, sprint);

    // a sprint weekend: the sprint (type 15, a later race in the structure) commits the team's last chosen plan (C62d)
    b.play(sessionPackets({ uid: 110n, type: 15, structure: SPRINT_WEEKEND, frames: 60 }));
    await b.ended(1);
    expectCommitted(b.decisions(110n, 0).map(given), [[0, sprint.cars[0]!]], 'the sprint');
    // the plan chosen for the grand prix (type 16) is the one it commits
    writeLastChoice(b.dataDir, grandPrix.id);
    b.play(sessionPackets({ uid: 111n, type: 16, structure: SPRINT_WEEKEND, frames: 60 }));
    await b.ended(2);
    await b.stop();
    expectCommitted(b.decisions(111n, 0).map(given), [[0, grandPrix.cars[0]!]], 'the grand prix');
    expectCommitted(b.sidecar(110n, 0), [[0, sprint.cars[0]!]], 'the sprint\'s sidecar');
    expectCommitted(b.sidecar(111n, 0), [[0, grandPrix.cars[0]!]], 'the grand prix\'s sidecar');
  });

  it('restart', async () => {
    const b = await bridge({ feeds: [A] });
    choosePlan(b.dataDir, PREPARED);
    // the first attempt: lap 1 only, no SEND; the league restarts the race with a new session uid
    b.play(sessionPackets({ uid: 120n, type: 15, frames: 60, send: false }));
    await decisionsReach(b, 120n, 0, COMMIT_COUNT);
    b.play(sessionPackets({ uid: 121n, type: 15, frames: 60 }));
    await vi.waitFor(() => expect(b.stored(121n, 0)).toBe(true));
    await decisionsReach(b, 121n, 0, COMMIT_COUNT);
    // the restart ends by the timer (the first attempt ended when the new uid arrived)
    await b.endedSession(121n, 0);
    await b.stop();

    // a new race session: committed again (§7.0 rule 8)
    for (const uid of [120n, 121n]) {
      expectCommitted(b.decisions(uid, 0).map(given), [CAR0, CAR1], `session ${uid}: the log`);
      expectCommitted(b.sidecar(uid, 0), [CAR0, CAR1], `session ${uid}: the sidecar`);
      // a replay of each recording alone, with its sidecar, gives the same decisions (C76), on the same frames
      expect(await replayDecisions(b.recording(uid, 0), A), `session ${uid}: the replay`).toEqual(b.decisions(uid, 0));
    }
  });

  it('flashback', async () => {
    const b = await bridge({ feeds: [A] });
    choosePlan(b.dataDir, PREPARED);
    // the race to lap 3 (frames 0–299), then the game flashes back to frame 150 (lap 2): FLBK, and the frames from 151
    // again, with their frame ids and session times
    const original = sessionPackets({ uid: RACE, type: 15, frames: 300, send: false });
    const fork = sessionPackets({
      uid: RACE, type: 15, frames: 260,
      events: (i) => (i === 151 ? [{ code: 'FLBK', flashbackFrameIdentifier: 150, flashbackSessionTime: (150 * 16) / 1000 }] : []),
    });
    b.play(original);
    await decisionsReach(b, RACE, 0, COMMIT_COUNT);
    b.play(afterFlashback(fork, 151, 300));
    await b.ended(1);
    await b.stop();

    // the flashback happened (a void fact), and the commit lies before its target: it stays (C27a)
    expect(b.voids(RACE, 0).length).toBeGreaterThan(0);
    expectCommitted(b.decisions(RACE, 0).map(given), [CAR0, CAR1], 'the log');
    expectCommitted(b.sidecar(RACE, 0), [CAR0, CAR1], 'the sidecar');
  });

  it('accept', async () => {
    const b = await bridge();
    // no plan chosen: the race commits nothing; the engineer accepts the board's prefill (SP4.3d spec §7.1 step 7)
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 200 }), A);
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 200, player: 1 }), B);
    a.to(20);
    bb.to(20);
    await vi.waitFor(() => expect(b.stored(RACE, 0) && b.stored(RACE, 1)).toBe(true), { timeout: 20_000 });
    const accept = (car: number, slot: Slot, policy: Policy) => ({ kind: 'plan.accept', feedId: A, carId: car, slot, policy });

    // car 0 has no active plan: A saved and active on both feeds
    expect(await b.send(accept(0, 'A', POLICY_A))).toEqual({ ok: true });
    // car 1 has B active: accepting A saves A only
    expect(await b.send({ kind: 'plan.save', feedId: A, carId: 1, slot: 'B', policy: POLICY_B })).toEqual({ ok: true });
    a.to(40);
    bb.to(40);
    expect(await b.send({ kind: 'plan.activate', feedId: A, carId: 1, slot: 'B' })).toEqual({ ok: true });
    a.to(60);
    bb.to(60);
    expect(await b.send(accept(1, 'A', POLICY_C))).toEqual({ ok: true });
    // plan.save's range check (C73): a stop past the race's laps is rejected, nothing stored
    expect(await b.send(accept(0, 'C', POLICY_G1))).toMatchObject({ ok: false, reason: 'invalid' });
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    const expected: GivenDecision[] = [
      { kind: 'planSaved', carId: carId(0), slot: 'A', policy: POLICY_A },
      { kind: 'planCommitted', carId: carId(0), policy: POLICY_A, slot: 'A' },
      { kind: 'planSaved', carId: carId(1), slot: 'B', policy: POLICY_B },
      { kind: 'planCommitted', carId: carId(1), policy: POLICY_B, slot: 'B' },
      { kind: 'planSaved', carId: carId(1), slot: 'A', policy: POLICY_C },
    ];
    for (const player of [0, 1]) {
      const decisions = b.decisions(RACE, player);
      expect(decisions.map(given), `feed of car ${player}`).toEqual(expected);
      expect(activeSlot({ decisions }, carId(0))).toBe('A');
      expect(activeSlot({ decisions }, carId(1))).toBe('B');
      expect(planSlots({ decisions }, carId(1))).toEqual({ A: POLICY_C, B: POLICY_B });
      expect(b.sidecar(RACE, player), `feed of car ${player}: the sidecar`).toEqual(expected);
    }
  });

  /** Both team feeds run the race through; `setup` prepares the data dir first. */
  const raceOnBoth = async (setup: (dataDir: string) => void): Promise<Bridge> => {
    const b = await bridge();
    setup(b.dataDir);
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 120 }), A);
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 120, player: 1 }), B);
    for (const at of [5, 10, 20, 40]) {
      a.to(at);
      bb.to(at);
    }
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();
    return b;
  };

  it('(e) none: no last choice commits nothing', async () => {
    // a saved plan on the track, but the team never chose or saved one last: nothing committed, nothing written (the
    // race's board prefills on the grid)
    const b = await raceOnBoth((dataDir) => writePlan(dataDir, PREPARED));
    for (const player of [0, 1]) {
      expect(b.decisions(RACE, player), `feed of car ${player}`).toEqual([]);
      expect(b.sidecar(RACE, player), `feed of car ${player}: the sidecar`).toEqual([]);
    }
  });

  it('(e) none: a last choice naming no plan commits nothing', async () => {
    const b = await raceOnBoth((dataDir) => {
      writePlan(dataDir, PREPARED);
      writeLastChoice(dataDir, null);
    });
    for (const player of [0, 1]) {
      expect(b.decisions(RACE, player), `feed of car ${player}`).toEqual([]);
      expect(b.sidecar(RACE, player), `feed of car ${player}: the sidecar`).toEqual([]);
    }
  });

  it('(e) a later basis.choose with another plan commits its decisions on each team feed', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, PREPARED);
    /** Car 0: A (another policy) and C, C active; car 1: B active. Car 0's B and G1 and car 1's C are slots it lacks. */
    const evening = savedPlan('evening', [
      { raceNumber: RACE_NUMBER(0), slots: { A: POLICY_X, C: POLICY_C }, active: 'C' },
      { raceNumber: RACE_NUMBER(1), slots: { B: POLICY_B }, active: 'B' },
    ]);
    writePlan(b.dataDir, evening);
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 200 }), A);
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 200, player: 1 }), B);
    for (const at of [5, 10, 20, 40]) {
      a.to(at);
      bb.to(at);
    }
    await decisionsReach(b, RACE, 0, COMMIT_COUNT);
    await decisionsReach(b, RACE, 1, COMMIT_COUNT);

    // the engineer chooses the evening plan on feed A (the basis unchanged: none)
    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: evening.id })).toEqual({ ok: true });
    a.to(80);
    bb.to(80);
    // its slots saved, the slots it lacks removed, its active slot committed, per car (`planDecisionsOf`)
    const chosen: GivenDecision[] = [
      { kind: 'planSaved', carId: carId(0), slot: 'A', policy: POLICY_X },
      { kind: 'planSaved', carId: carId(0), slot: 'C', policy: POLICY_C },
      { kind: 'planRemoved', carId: carId(0), slot: 'B' },
      { kind: 'planRemoved', carId: carId(0), slot: 'G1' },
      { kind: 'planCommitted', carId: carId(0), policy: POLICY_C, slot: 'C' },
      { kind: 'planSaved', carId: carId(1), slot: 'B', policy: POLICY_B },
      { kind: 'planRemoved', carId: carId(1), slot: 'C' },
      { kind: 'planCommitted', carId: carId(1), policy: POLICY_B, slot: 'B' },
    ];
    await decisionsReach(b, RACE, 0, COMMIT_COUNT + chosen.length);
    await decisionsReach(b, RACE, 1, COMMIT_COUNT + chosen.length);
    // "none" afterwards commits nothing
    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: null })).toEqual({ ok: true });
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    for (const player of [0, 1]) {
      const decisions = b.decisions(RACE, player);
      const later = decisions.slice(COMMIT_COUNT).map(given);
      for (const c of [0, 1]) expect(ofCar(later, c), `feed of car ${player}: car ${c}`).toEqual(ofCar(chosen, c));
      expect(later, `feed of car ${player}: nothing else`).toHaveLength(chosen.length);
      expect(planSlots({ decisions }, carId(0))).toEqual({ A: POLICY_X, C: POLICY_C });
      expect(activeSlot({ decisions }, carId(0))).toBe('C');
      expect(planSlots({ decisions }, carId(1))).toEqual({ B: POLICY_B });
      expect(b.sidecar(RACE, player).slice(COMMIT_COUNT), `feed of car ${player}: the sidecar`).toHaveLength(chosen.length);
    }
  });

  it('restart then join', async () => {
    // the first bridge: feed A runs the race alone to lap 3, commits the chosen plan, then the engineer saves car 0's C
    const first = await bridge();
    choosePlan(first.dataDir, PREPARED);
    // the game resends Session and Participants at frame 280: the restarted bridge's first packet continues the recording
    const race = sessionPackets({ uid: RACE, type: 15, frames: 400, resendAt: [280] });
    const a1 = first.player(race, A);
    a1.to(250);
    await decisionsReach(first, RACE, 0, COMMIT_COUNT);
    expect(await first.send({ kind: 'plan.save', feedId: A, carId: 0, slot: 'C', policy: POLICY_C })).toEqual({ ok: true });
    a1.to(280);
    await decisionsReach(first, RACE, 0, COMMIT_COUNT + 1);
    await first.stop();
    // the saved plan changes while the bridge is down: the joining feed is handed the team's plan decisions, never the plan
    writePlan(first.dataDir, savedPlan(PREPARED.id, [{ raceNumber: RACE_NUMBER(1), slots: { A: POLICY_X }, active: 'A' }]));

    // the restarted bridge on the same data dir: feed A's recording continues (C59) and goes live past lap 3
    const b = await bridge({ dataDir: first.dataDir });
    const a = b.player(race.filter(({ packet }) => packet.header.frameIdentifier >= 280), A);
    a.to(320);
    await vi.waitFor(() => expect(b.lapStored(RACE, 0, 0, 3)).toBe(true), { timeout: 20_000 });
    expect(b.decisions(RACE, 0)).toHaveLength(COMMIT_COUNT + 1);

    // the teammate's feed joins at lap 4: per car its newest decision per slot and its active plan (C76)
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 60, player: 1, lapOf: () => 4 }), B);
    bb.to(30);
    await vi.waitFor(() => expect(b.stored(RACE, 1)).toBe(true), { timeout: 20_000 });
    const car0: PreparedCar = { raceNumber: RACE_NUMBER(0), slots: { A: POLICY_A, B: POLICY_B, C: POLICY_C, G1: POLICY_G1 }, active: 'A' };
    await vi.waitFor(() => expect(b.decisions(RACE, 1)).toHaveLength(committedFor(0, car0).length + committedFor(...CAR1).length), { timeout: 20_000 });
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    const joined = b.decisions(RACE, 1);
    expectCommitted(joined.map(given), [[0, car0], CAR1], 'the joining feed');
    expect(new Set(joined.map((d) => d.frame)).size).toBe(1);
    expectCommitted(b.sidecar(RACE, 1), [[0, car0], CAR1], 'the joining feed\'s sidecar');
  });

  it('restart then join, voided', async () => {
    // the first bridge: feed A runs the race to lap 3 (frames 0–299) and commits the chosen plan at its start; at frame
    // 250 the engineer saves car 0's C; then the game flashes back to frame 150: the save is voided (C27a), the commit stays
    const first = await bridge();
    choosePlan(first.dataDir, PREPARED);
    const a1 = first.player(sessionPackets({ uid: RACE, type: 15, frames: 300, send: false }), A);
    a1.to(250);
    await decisionsReach(first, RACE, 0, COMMIT_COUNT);
    expect(await first.send({ kind: 'plan.save', feedId: A, carId: 0, slot: 'C', policy: POLICY_C })).toEqual({ ok: true });
    a1.rest();
    await decisionsReach(first, RACE, 0, COMMIT_COUNT + 1);
    // the fork from frame 151 on, Session and Participants resent at its frame 200, where the restarted bridge takes over
    const fork = afterFlashback(sessionPackets({
      uid: RACE, type: 15, frames: 400, resendAt: [200],
      events: (i) => (i === 151 ? [{ code: 'FLBK', flashbackFrameIdentifier: 150, flashbackSessionTime: (150 * 16) / 1000 }] : []),
    }), 151, 300);
    const f1 = first.player(fork, A);
    f1.to(200);
    await vi.waitFor(() => expect(first.voids(RACE, 0).length).toBeGreaterThan(0), { timeout: 20_000 });
    await vi.waitFor(() => expect(first.decisions(RACE, 0)).toHaveLength(COMMIT_COUNT), { timeout: 20_000 });
    await first.stop();
    // the voided save is still in A's decisions sidecar (a recording keeps every decision it got, C76)
    expect(first.sidecar(RACE, 0)).toContainEqual({ kind: 'planSaved', carId: carId(0), slot: 'C', policy: POLICY_C });

    // the restarted bridge: feed A's recording continues (C59) and goes live past lap 3 again
    const b = await bridge({ dataDir: first.dataDir });
    const a = b.player(fork.filter(({ packet }) => packet.header.frameIdentifier >= 200), A);
    a.to(320);
    await vi.waitFor(() => expect(b.lapStored(RACE, 0, 0, 3)).toBe(true), { timeout: 20_000 });

    // the teammate's feed joins: it is handed the commit, never the voided save (the projection's decisions, C27a, C28)
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 60, player: 1, lapOf: () => 4 }), B);
    bb.to(30);
    await vi.waitFor(() => expect(b.stored(RACE, 1)).toBe(true), { timeout: 20_000 });
    await decisionsReach(b, RACE, 1, COMMIT_COUNT);
    a.rest();
    bb.rest();
    await b.ended(2);
    await b.stop();

    expectCommitted(b.decisions(RACE, 1).map(given), [CAR0, CAR1], 'the joining feed');
    expectCommitted(b.sidecar(RACE, 1), [CAR0, CAR1], 'the joining feed\'s sidecar');
  });

  it('segment pair', async () => {
    const b = await bridge({ feeds: [A] });
    const records = async (file: string) => {
      const out: Array<{ bytes: Uint8Array; t: number }> = [];
      for await (const r of readPwrec(segmentPath(file))) out.push({ bytes: r.payload, t: r.t });
      return out;
    };
    // the one-shot qualifying ends by the timer (the fake clock runs through the gap): its round opens (the runner
    // replays its recording); the engineer accepts A for our car and saves the round as the team's plan
    b.playRaw(await records('qualifying-texas-send.pwrec.gz'));
    await b.ended(1);
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, running: false }), { timeout: 60_000 });
    const [ours, prepared] = Object.entries(b.round().cars)[0]!;
    // no stored race suggests the laps: the engineer enters them before the round plans (ruling R16)
    expect(await b.send({ kind: 'plans.race.set', feedId: A, race: { laps: 56, sets: 'carried' } })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().race).toEqual({ laps: 56, sets: 'carried' }));
    expect(await b.send({ kind: 'plans.prepare.accept', feedId: A, carId: Number(ours), slot: 'A', policy: POLICY_A })).toEqual({ ok: true });
    expect(await b.send({ kind: 'plans.save', feedId: A, name: 'Texas' })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.round().saved).toHaveLength(1));
    const qualifyingUid = b.reader.prepare('SELECT session_uid FROM sessions WHERE complete = 1').pluck().get() as string;

    // the race loads on the same feed: the saved plan, the team's last saved one on the track, lands in its log as
    // planSaved and planCommitted with slot A
    b.playRaw(await records('race-texas-grid.pwrec.gz'));
    const raceUid = (): string | undefined =>
      b.reader.prepare('SELECT session_uid FROM sessions WHERE session_uid != ?').pluck().get(qualifyingUid) as string | undefined;
    await vi.waitFor(() => expect(raceUid()).toBeDefined(), { timeout: 20_000 });
    const uid = BigInt(raceUid()!);
    const playerCar = b.reader.prepare('SELECT player_car FROM sessions WHERE session_uid = ?').pluck().get(uid.toString()) as number;
    // the race's car that carries the prepared car's race number (C62)
    const raceCar = b.reader
      .prepare('SELECT car_id FROM cars WHERE session_uid = ? AND race_number = ?')
      .pluck()
      .get(uid.toString(), prepared.raceNumber) as number | undefined;
    expect(raceCar).toBeDefined();
    await vi.waitFor(() => expect(ofCar(b.decisions(uid, playerCar).map(given), raceCar!)).toEqual([
      { kind: 'planSaved', carId: raceCar, slot: 'A', policy: POLICY_A },
      { kind: 'planCommitted', carId: raceCar, policy: POLICY_A, slot: 'A' },
    ]), { timeout: 20_000 });
  });
});

// SP4.3d2 final review F1 (C13, C43; ruling R36): the race's slots are the slots car-status has in the session (not
// `absent`), with their live-state identity (team and race number), never a slice by the Participants signal
// `numActiveCars`. car-status counts a car out of the race (retired) as one more slot in use than `numActiveCars`.
describe('the race-start commit takes the race slots from car-status (final review F1; C13, C43)', { timeout: 120_000 }, () => {
  it('slot past numActiveCars', async () => {
    const b = await bridge({ feeds: [A] });
    // eight slots, slot 3 retired: numActiveCars counts 7, car-status has 8 slots in use; race number 20 drives slot 7
    const race: Participant[] = [
      { teamId: TEAM, raceNumber: 1 }, { teamId: 4, raceNumber: 2 }, { teamId: 4, raceNumber: 3 }, { teamId: 5, raceNumber: 4 },
      { teamId: 5, raceNumber: 5 }, { teamId: 6, raceNumber: 6 }, { teamId: 6, raceNumber: 7 }, { teamId: TEAM, raceNumber: 20 },
    ];
    const prepared = savedPlan('slot-7', [PREPARED.cars[0]!, { raceNumber: 20, slots: { C: POLICY_C }, active: 'C' }]);
    choosePlan(b.dataDir, prepared);
    b.play(sessionPackets({ uid: RACE, type: 15, participants: race, numActiveCars: 7, resultStatusOf: (car) => (car === 3 ? 7 : 2), frames: 60 }));
    await b.ended(1);
    await b.stop();

    // slot 7 competes (car-status), so race number 20's plans are committed to it
    expectCommitted(b.decisions(RACE, 0).map(given), [CAR0, [7, prepared.cars[1]!]], 'the log');
    expectCommitted(b.sidecar(RACE, 0), [CAR0, [7, prepared.cars[1]!]], 'the sidecar');
  });

  it('absent slot', async () => {
    const b = await bridge({ feeds: [A] });
    choosePlan(b.dataDir, PREPARED);
    // slot 1 (race number 2, team 3) lies below numActiveCars but is inactive: car-status has it absent
    b.play(sessionPackets({ uid: RACE, type: 15, resultStatusOf: (car) => (car === 1 ? 1 : 2), frames: 60 }));
    await b.ended(1);
    await b.stop();

    // car 0 is committed; the absent slot gets nothing
    const decisions = b.decisions(RACE, 0).map(given);
    expectCommitted(decisions, [CAR0], 'the log');
    expect(ofCar(decisions, 1)).toEqual([]);
    expectCommitted(b.sidecar(RACE, 0), [CAR0], 'the sidecar');
  });
});

// SP4.3e Task 7e: `basis.active.plan` shows the chosen plan (C1a, C54, C55, C62d, C65; spec §2 anti-goal, §4.3). Per
// feed it is the plan named by the newest plan choice that reached the feed (the race-start commit of the team's last
// chosen or saved plan, or a later `basis.choose` with `plan` set; `plan: null` there is none), looked up in the saved
// plans as `{ id, name, laps: computedOn.race.laps }`, beside the race's laps (`raceLaps`), never adjusted; `null`
// before any choice, for none, once the plan is deleted, and outside a race or sprint. Republished on each of the team's
// feeds when the choice changes and when the plan is renamed.
describe('basis.active shows the chosen plan (Task 7e; C1a, C54, C55, C62d)', { timeout: 120_000 }, () => {
  /** The race laps the plans here were computed for: not the race's, shown beside them, not judged (C65). */
  const PLAN_LAPS = 56;
  const planOf = (id: string, name: string): SavedPlan => ({
    ...savedPlan(id, PREPARED.cars),
    name,
    computedOn: { basis: NO_BASIS, race: { laps: PLAN_LAPS, sets: 'carried' } },
  });
  const P = planOf('p', 'Texas morning');
  const Q = planOf('q', 'Texas evening');
  const shown = (plan: SavedPlan, name = plan.name): BasisActive['plan'] => ({ id: plan.id, name, laps: PLAN_LAPS });

  /** Waits until both team feeds' newest `basis.active` shows `plan`. */
  const bothShow = async (b: Bridge, plan: BasisActive['plan'], what: string): Promise<void> => {
    await vi.waitFor(() => {
      for (const feed of [A, B]) expect(b.active(feed)?.plan, `${what}: feed ${feed}`).toEqual(plan);
    }, { timeout: 20_000 });
  };

  /** A race (10 laps) on both team feeds, run to frame 40: the race-start commit has been made. */
  const raceOnBoth = async (b: Bridge) => {
    const a = b.player(sessionPackets({ uid: RACE, type: 15, frames: 300 }), A);
    const bb = b.player(sessionPackets({ uid: RACE, type: 15, frames: 300, player: 1 }), B);
    for (const at of [5, 10, 20, 40]) {
      a.to(at);
      bb.to(at);
    }
    await decisionsReach(b, RACE, 0, COMMIT_COUNT);
    await decisionsReach(b, RACE, 1, COMMIT_COUNT);
    return { to: (frame: number): void => { a.to(frame); bb.to(frame); } };
  };

  it('(a) a race whose team\'s last choice names saved plan P publishes plan { id, name, laps } and raceLaps on both team feeds at the first frame with the team known', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, P);
    await raceOnBoth(b);
    await bothShow(b, shown(P), 'the race-start commit');
    for (const feed of [A, B]) {
      const value = b.active(feed)!;
      // the plan's laps beside the race's, never adjusted (C65)
      expect(value.plan?.laps, `feed ${feed}: the plan's laps`).toBe(PLAN_LAPS);
      expect(value.raceLaps, `feed ${feed}: the race's laps`).toBe(RACE_LAPS);
    }
  });

  it('(b) basis.choose with plan Q republishes Q on both feeds; with plan null it is null; with plan undefined it is unchanged', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, P);
    writePlan(b.dataDir, Q);
    const race = await raceOnBoth(b);
    await bothShow(b, shown(P), 'the race-start commit');

    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: Q.id })).toEqual({ ok: true });
    race.to(80);
    await bothShow(b, shown(Q), 'Q chosen on feed A');

    // `plan` undefined keeps the plan: Q stays, also after more frames (the answer comes once the choice is committed)
    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS })).toEqual({ ok: true });
    race.to(120);
    // Q's commit (the same cars as the race-start commit's plan) reached the log: the frames after the choices applied
    await decisionsReach(b, RACE, 0, 2 * COMMIT_COUNT);
    for (const feed of [A, B]) expect(b.active(feed)?.plan, `plan kept: feed ${feed}`).toEqual(shown(Q));

    // `plan: null` is none
    expect(await b.send({ kind: 'basis.choose', feedId: B, basis: NO_BASIS, plan: null })).toEqual({ ok: true });
    race.to(160);
    await bothShow(b, null, 'none chosen on feed B');
  });

  it('(c) renaming Q republishes its new name on both feeds; deleting it gives null', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, P);
    writePlan(b.dataDir, Q);
    const race = await raceOnBoth(b);
    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: Q.id })).toEqual({ ok: true });
    race.to(80);
    await bothShow(b, shown(Q), 'Q chosen');

    expect(await b.send({ kind: 'plans.rename', feedId: A, id: Q.id, name: 'Texas final' })).toEqual({ ok: true });
    await bothShow(b, shown(Q, 'Texas final'), 'Q renamed');

    expect(await b.send({ kind: 'plans.delete', feedId: B, id: Q.id })).toEqual({ ok: true });
    await bothShow(b, null, 'Q deleted');
  });

  it('(d) a qualifying session shows plan null', async () => {
    const b = await bridge({ feeds: [A] });
    choosePlan(b.dataDir, P);
    b.play(sessionPackets({ uid: 120n, type: 5, frames: 120 }));
    await b.ended(1);
    await b.stop();
    const values = b.actives(A);
    expect(values.length, 'basis.active published').toBeGreaterThan(0);
    for (const value of values) {
      expect(value.plan, 'a qualifying chooses no plan').toBeNull();
      expect(value.raceLaps, 'a qualifying has no race laps').toBeNull();
    }
  });

  // Ruling R20 (C38, C59, C76): the bridge records each plan choice that reaches a feed in the feed's basis sidecar,
  // `<recording>.basis.json` `plans: { at: <record index>, plan: { id, name, laps } | null }[]`, positional like the
  // decisions sidecar's record index; a replay and a reprocess republish `basis.active.plan` from it at the same record.
  // A rename after the race is not replayed: the recorded name stands. A recording without `plans` replays `plan: null`.
  it('(e) a live race with plan choices, then its replay: basis.active.plan equal at every frame; a recording without plans in its sidecar replays plan null', async () => {
    const b = await bridge();
    choosePlan(b.dataDir, P);
    writePlan(b.dataDir, Q);
    const race = await raceOnBoth(b);
    await bothShow(b, shown(P), 'the race-start commit');
    // what each live feed showed after frame 39, 79 and 159 (the checkpoints the replay is read at)
    const live: Record<string, BasisActive['plan'][]> = {};
    const checkpoint = (): void => {
      for (const feed of [A, B]) (live[feed] ??= []).push(b.active(feed)!.plan);
    };
    checkpoint();
    expect(await b.send({ kind: 'basis.choose', feedId: A, basis: NO_BASIS, plan: Q.id })).toEqual({ ok: true });
    race.to(80);
    await bothShow(b, shown(Q), 'Q chosen on feed A');
    checkpoint();
    expect(await b.send({ kind: 'basis.choose', feedId: B, basis: NO_BASIS, plan: null })).toEqual({ ok: true });
    race.to(160);
    await bothShow(b, null, 'none chosen on feed B');
    checkpoint();
    race.to(Infinity);
    await b.ended(2);
    // renamed after the race: the replay keeps the name the race recorded
    expect(await b.send({ kind: 'plans.rename', feedId: A, id: Q.id, name: 'Texas renamed later' })).toEqual({ ok: true });
    await b.stop();
    expect(live[A]).toEqual([shown(P), shown(Q), null]);
    expect(live[B]).toEqual([shown(P), shown(Q), null]);

    for (const [feed, player] of [[A, 0], [B, 1]] as const) {
      const file = b.recording(RACE, player);
      // the basis sidecar records each choice that reached the feed, at its record index, in order
      const plans = (JSON.parse(readFileSync(`${file}.basis.json`, 'utf8')) as { plans?: Array<{ at: number; plan: BasisActive['plan'] }> }).plans;
      expect(plans?.map((p) => p.plan), `feed ${feed}: the sidecar's plans`).toEqual([shown(P), shown(Q), null]);
      const at = plans!.map((p) => p.at);
      for (const index of at) expect(Number.isInteger(index) && index >= 0, `feed ${feed}: a record index`).toBe(true);
      expect([...at].sort((x, y) => x - y), `feed ${feed}: in record order`).toEqual(at);

      // the replay: the same plan at every frame as the live run showed it (C38)
      const replayed = await replayPlans(file, feed);
      expect(replayed.length, `feed ${feed}: the replay ran`).toBeGreaterThan(160);
      expect([replayed[30], replayed[75], replayed[150]], `feed ${feed}: the checkpoints`).toEqual(live[feed]);
      expect(replayed.at(-1), `feed ${feed}: the last frame`).toBeNull();
      expect(changes(replayed), `feed ${feed}: the plans shown, in order`).toEqual(changes(b.actives(feed).map((v) => v.plan)));
      expect(changes(replayed)).toEqual([shown(P), shown(Q), null]);
    }

    // a recording whose basis sidecar has no `plans`: plan null at every frame
    const file = b.recording(RACE, 0);
    const { plans: _plans, ...without } = JSON.parse(readFileSync(`${file}.basis.json`, 'utf8')) as Record<string, unknown>;
    writeFileSync(`${file}.basis.json`, JSON.stringify(without));
    const bare = await replayPlans(file, A);
    expect(bare.length, 'the replay ran').toBeGreaterThan(160);
    expect(bare.some((plan) => plan === null), 'basis.active published').toBe(true);
    expect(bare.every((plan) => plan === null || plan === undefined), 'no plans recorded: none shown').toBe(true);
  });
});

/** The values of `plans`, each change once, the leading `null`s (and `undefined`s: nothing published yet) left out. */
const changes = (plans: ReadonlyArray<BasisActive['plan'] | undefined>): Array<BasisActive['plan']> => {
  const out: Array<BasisActive['plan']> = [];
  for (const plan of plans) {
    if (plan === undefined || (plan === null && out.length === 0)) continue;
    if (out.length > 0 && JSON.stringify(out.at(-1)) === JSON.stringify(plan)) continue;
    out.push(plan);
  }
  return out;
};

/**
 * Replays (reprocesses) a recording alone with its sidecars (C38, C76), as `serve`'s replay hands them to the pipeline
 * (no saved plans: what it shows comes from the recording): the `basis.active` plan published as of each frame (the
 * newest one when the frame's calculators run; `undefined` before any), one entry per frame.
 */
async function replayPlans(file: string, id: FeedId): Promise<Array<BasisActive['plan'] | undefined>> {
  const hub = new TopicHub({ now: () => 0 });
  const published = vi.spyOn(hub, 'publishState');
  const newest = (): BasisActive['plan'] | undefined => {
    const call = published.mock.calls.filter(([feed, topic]) => feed === id && topic === 'basis.active').at(-1);
    return call === undefined ? undefined : (call[2]({}) as BasisActive).plan;
  };
  const perFrame: Array<BasisActive['plan'] | undefined> = [];
  const probe: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.plan-probe',
    reads: ['feed'],
    cadence: 'frame',
    compute: () => {
      perFrame.push(structuredClone(newest()));
      return perFrame.length;
    },
  };
  const db = openDatabase(join(tmp('replay'), 'replay.db'));
  cleanup.push(() => db.close());
  const pipeline = new FeedPipeline({
    feedId: id,
    source: new PwrecSource({ feedId: id, path: file, mode: 'asFastAsPossible' }),
    hub,
    features: [defineFeature({ name: 'plan-probe', calculators: [probe], topics: [] })],
    log,
    teams: new TeamFeeds(),
    recorded: recordingDecisions(file),
    recordedBasis: recordingBasis(file, log),
    storage: { db, rulesVersion: RULES, mode: 'replace', sourcePath: file },
  });
  pipeline.start();
  await pipeline.done;
  // the value after the last frame counts too
  if (perFrame.length > 0) perFrame[perFrame.length - 1] = structuredClone(newest());
  return perFrame;
}
