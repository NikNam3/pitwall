// Shared setup of the session-basis pipeline tests (SP4.3e Task 7a-2; C1a, C38, C39, C59, C61, C62, C76; spec §4.2).
// Builder sessions only (C84: no recording asserted, no real data dir): earlier sessions of a seat are stored by live
// pipelines into one temporary database, then a race runs on manual sources (live-like) and is replayed from the
// session file it wrote, with its sidecars.
//
// The seam this task adds to the bridge, loaded through dynamic imports so the tests compile before the modules exist:
//
// - `src/pipeline/basis-sidecar.ts` exports `basisSidecarPath(file)` (`<file>.basis.json`) and
//   `recordingBasis(file, log?)`: the recording's `BasisSidecar` (`{ start, preselected }`), `null` without one.
// - `FeedPipelineOptions.basis` (live): `{ rebuild: Pick<RebuildService, 'ensureCurrent'>; lastChoice:
//   Pick<LastChoiceStore, 'read'> }`. At a session's first Participants the pipeline preselects its basis (C62, Task
//   7a-1's `preselect` over the stored rows of the seat and `lastChoice.read(team, track)`), starts the session on the
//   preselection's current sessions (`view.basis` from its first frame), writes `<file>.basis.json` `{ start,
//   preselected }`, and queues the stale ones with `rebuild.ensureCurrent(keys, { priority: 'runningBasis' })`; no frame
//   waits for it. Once they are current it commits `basisChosen { basis: preselected }` (to the runner with its next
//   frame and to the decisions sidecar), unless a basis was chosen since.
// - `FeedPipelineOptions.recordedBasis` (a replay or reprocess): the recording's basis sidecar (`recordingBasis`); the
//   session starts on its `start` (loaded from `storage.db`), never preselects and never commits; the recorded
//   `basisChosen` decisions come back from the decisions sidecar (`recorded`, C38, C76).
// - `src/pipeline/basis-routing.ts` exports `BasisRouting`: `new BasisRouting({ teams, pipelines, rebuild, plans })`
//   over the bridge's `TeamFeeds`, `serve`'s map of pipelines by feed, the rebuild service and the saved plans'
//   `PlanChoice` (Task 7b; a fake here). `choose(action)` takes a decoded `basis.choose` of feed `action.feedId` and
//   answers once done (C73): serialised per team; `ensureCurrent` of the named sessions of each team feed's seat
//   (priority `runningBasis`); then `basisChosen { basis }` on each of the team's feeds running a session (each its own
//   engine's next frame, its own decisions sidecar), each loading the named sessions of its own player's seat (a session
//   the feed has not stored is missing from its `view.basis`, never an error); then, unless `action.plan` is
//   `undefined`, `plans.choosePlan(team, trackId, action.plan)`. A feed that joins the team later is handed the team's
//   newest `basisChosen` at its first frame with its team known.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, vi } from 'vitest';
import type { TopicValue, UiAction } from '@pitwall/contracts';
import { feedId, type BasisSidecar, type DecisionRecord, type FeedId, type SessionBasis, type SessionRef } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger, type Logger } from '../../src/log.ts';
import { recordingDecisions } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type DecisionResult, type FeedPipelineOptions } from '../../src/pipeline/feed-pipeline.ts';
import type { LastChoice, LastChoiceStore, PlanChoice } from '../../src/pipeline/last-choice-types.ts';
import { TeamFeeds } from '../../src/pipeline/team-feeds.ts';
import { openDatabase, type Db, type SessionKey } from '../../src/storage/db.ts';
import type { RebuildPriority, RebuildService } from '../../src/storage/rebuild-service-types.ts';
import { ArraySource } from '../helpers/array-source.ts';
import { ManualSource } from '../helpers/manual-source.ts';

export type Timed = ReturnType<ScenarioBuilder['packets']>;
/** The value of `basis.active` (its topic file, C54). */
export type BasisActive = TopicValue<'basis.active'>;

export const log = createLogger({ level: 'silent' });
export const tmp = (): string => mkdtempSync(join(tmpdir(), 'basis-'));

/** The rules version of this bridge (C61); a stored session of any other is stale. */
export const RULES = 'rules-now';
const OLD_RULES = 'rules-of-an-earlier-bridge';

export const A = feedId('udp-20777');
export const B = feedId('udp-20778');
/** Slots 0 and 1 drive for team 3 (race numbers 1 and 2), slots 2 and 3 for team 4. */
export const TEAMS = [3, 3, 4, 4] as const;
export const TEAM = 3;
/** The builder's track. */
export const TRACK = 0;
/** A short weekend: short practice (type 4), short qualifying (type 8), the race (type 15). */
const STRUCTURE = [4, 8, 15];
export const SESSION_TYPE = { practice: 4, qualifying: 8, race: 15 } as const;

/** The race's session uid. */
export const RACE_UID = 7n;
/** Wall-clock times of the stored sessions and the race (ms): practice, then qualifying, then the race. */
export const AT = { practice: 1_763_400_000_000, qualifying: 1_763_403_600_000, race: 1_763_407_200_000 } as const;

/** A builder session of `uid` and `type` in weekend `weekend`, player car `player`; Participants name every slot's team. */
export const builder = (o: { uid: bigint; weekend: number; type: number; player: number; track?: number }): ScenarioBuilder =>
  sessionAgain(new ScenarioBuilder({ sessionUid: o.uid, cars: TEAMS.length, player: o.player }), o);

/**
 * Queues the session's Session and Participants packets again, sent with the next frame, as the game repeats them: a
 * restarted bridge's first Session packet is one of these (C59). `track`: default the builder's (`TRACK`).
 */
export const sessionAgain = (b: ScenarioBuilder, o: { weekend: number; type: number; track?: number }): ScenarioBuilder =>
  b
    .session({
      sessionType: o.type,
      weekendStructure: STRUCTURE,
      numSessionsInWeekend: STRUCTURE.length,
      weekendLinkIdentifier: o.weekend,
      ...(o.track !== undefined && { trackId: o.track }),
    })
    .participants({ participants: TEAMS.map((teamId) => ({ teamId })) });

/** A stored session's key: the session ref and the seat's player car. */
export const keyOf = (ref: SessionRef, player: number): SessionKey => ({ sessionUid: ref.sessionUid, weekendId: ref.weekendId, playerCar: player }) as SessionKey;
export const refOf = (uid: bigint, weekend: number): SessionRef => ({ sessionUid: String(uid), weekendId: String(weekend) }) as SessionRef;
const keyText = (k: SessionKey): string => `${k.sessionUid}@${k.weekendId}/${k.playerCar}`;

/** Stores one builder session of the seat `player` complete under `RULES`, as a live run of the bridge does. */
export async function storeSession(db: Db, o: { uid: bigint; weekend: number; type: number; player: number; at: number; track?: number }): Promise<SessionRef> {
  const packets = builder(o).frames(30, () => {}).packets().map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
  const id = feedId(`store-${o.uid}-${o.player}`);
  const pipeline = new FeedPipeline({
    feedId: id,
    source: new ArraySource(id, packets),
    hub: new TopicHub({ now: () => 0 }),
    features: [],
    log,
    storage: { db, rulesVersion: RULES },
    wallClock: () => o.at,
  });
  pipeline.start();
  await pipeline.done;
  const ref = refOf(o.uid, o.weekend);
  expect(rulesOf(db, keyOf(ref, o.player)), `stored ${keyText(keyOf(ref, o.player))}`).toBe(RULES);
  return ref;
}

const rulesOf = (db: Db, k: SessionKey): string | undefined =>
  (db.prepare('SELECT rules_version FROM sessions WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').get(k.sessionUid, k.weekendId, k.playerCar) as { rules_version: string } | undefined)?.rules_version;

/** Makes a stored session stale, as a changed rules version does (C61). */
export const markStale = (db: Db, k: SessionKey): void => {
  db.prepare('UPDATE sessions SET rules_version = ? WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').run(OLD_RULES, k.sessionUid, k.weekendId, k.playerCar);
};

const markCurrent = (db: Db, k: SessionKey): void => {
  db.prepare('UPDATE sessions SET rules_version = ? WHERE session_uid = ? AND weekend_id = ? AND player_car = ?').run(RULES, k.sessionUid, k.weekendId, k.playerCar);
};

/**
 * A fake rebuild service (C61; the real one is Task 7d's): `ensureCurrent` makes every stale session of `refs` current
 * (its stored log is the builder's, unchanged), at once, or, for a session `hold` named, once the test `release`s it.
 */
export function fakeRebuild(db: Db) {
  const calls: Array<{ refs: SessionKey[]; priority: RebuildPriority | undefined }> = [];
  const held = new Map<string, PromiseWithResolvers<void>>();
  const ensureCurrent: RebuildService['ensureCurrent'] = vi.fn(async (refs, opts) => {
    calls.push({ refs: [...refs], priority: opts?.priority });
    // progress as the real service reports it: none done yet, then one more per session made current
    opts?.onProgress?.(0, refs.length);
    let done = 0;
    for (const k of refs) {
      const gate = held.get(keyText(k));
      if (gate !== undefined) await gate.promise;
      if (rulesOf(db, k) !== undefined) markCurrent(db, k);
      opts?.onProgress?.(++done, refs.length);
    }
  });
  return {
    service: { ensureCurrent } satisfies Pick<RebuildService, 'ensureCurrent'>,
    calls,
    /** The rebuild of `k` waits until `release(k)`. */
    hold: (k: SessionKey): void => {
      held.set(keyText(k), Promise.withResolvers());
    },
    release: (k: SessionKey): void => held.get(keyText(k))?.resolve(),
  };
}

/** A last-choice store that holds `choice` for every team and track (`undefined`: none). */
export const fakeLastChoice = (choice?: LastChoice): Pick<LastChoiceStore, 'read'> & { read: ReturnType<typeof vi.fn> } => ({ read: vi.fn(() => choice) });

/** A fake of the saved plans' `PlanChoice` (Task 7b). */
export const fakePlans = () => ({ choosePlan: vi.fn<PlanChoice['choosePlan']>(() => ({ ok: true })) });

/** What the probe saw on one frame: the race clock, the basis named and the sessions loaded (`uid/playerCar`), the decisions. */
export type Seen = { at: number; basis: SessionBasis | null; sessions: string[] | null; decisions: DecisionRecord[] };

/** A unit that keeps `view.basis` of every frame; it reads `decisions` (C62) and `feed`, which changes on every frame. */
export function basisProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.basis-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view: EngineView) => {
      const history = view.history as unknown as { decisions: readonly DecisionRecord[] };
      const basis = view.basis;
      seen.push({
        at: view.live.sessionTime,
        basis: basis === undefined ? null : (structuredClone(basis.basis) as SessionBasis),
        sessions: basis === undefined ? null : basis.sessions.map((s) => `${s.sessionUid}/${s.playerCar}`),
        decisions: structuredClone([...history.decisions]),
      });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'basis-probe', calculators: [calc], topics: [] }), seen };
}

/** The basis per frame, by race-clock time: what a replay must agree with its live run on (C38). */
export const basisPerFrame = (seen: readonly Seen[]) => seen.map((s) => [s.at, JSON.stringify(s.basis), JSON.stringify(s.sessions)]);
/** The `basisChosen` decisions of a frame. */
export const chosen = (s: Seen) => s.decisions.filter((d) => d.kind === 'basisChosen');
export const last = (seen: readonly Seen[]): Seen => {
  expect(seen.length, 'the probe ran').toBeGreaterThan(0);
  return seen.at(-1)!;
};

/** The packets of `packets` from frame `from` (by the header's frame id) to before `to`. */
export const slice = (packets: Timed, from: number, to: number): Timed =>
  packets.filter(({ packet }) => packet.header.frameIdentifier >= from && packet.header.frameIdentifier < to);

type SidecarEntry = { recordIndex: number; decision: { kind: string } & Record<string, unknown> };
/** A recording's decisions sidecar; none: `[]`. */
export const decisionsOf = (file: string): SidecarEntry[] =>
  existsSync(`${file}.decisions.json`) ? (JSON.parse(readFileSync(`${file}.decisions.json`, 'utf8')) as SidecarEntry[]) : [];
/** A recording's basis sidecar as written; none: `undefined`. */
export const basisSidecarOf = (file: string): unknown => (existsSync(`${file}.basis.json`) ? JSON.parse(readFileSync(`${file}.basis.json`, 'utf8')) : undefined);

type BasisAction = Extract<UiAction, { kind: 'basis.choose' }>;
export type BasisRouting = { choose(action: BasisAction): Promise<DecisionResult> };
type BasisRoutingClass = new (o: {
  teams: TeamFeeds;
  pipelines: ReadonlyMap<FeedId, FeedPipeline>;
  rebuild: Pick<RebuildService, 'ensureCurrent'>;
  plans: PlanChoice;
}) => BasisRouting;

const ROUTING = new URL('../../src/pipeline/basis-routing.ts', import.meta.url).pathname;
const SIDECAR = new URL('../../src/pipeline/basis-sidecar.ts', import.meta.url).pathname;

/** `BasisRouting` from its module. */
export async function basisRoutingClass(): Promise<BasisRoutingClass> {
  const mod = (await import(/* @vite-ignore */ ROUTING)) as { BasisRouting?: BasisRoutingClass };
  if (mod.BasisRouting === undefined) throw new Error('basis-routing.ts exports no BasisRouting');
  return mod.BasisRouting;
}

/** `recordingBasis` from its module. */
export async function recordingBasisOf(file: string): Promise<BasisSidecar | null> {
  const mod = (await import(/* @vite-ignore */ SIDECAR)) as { recordingBasis?: (file: string, log?: Logger) => BasisSidecar | null; basisSidecarPath?: (file: string) => string };
  if (mod.recordingBasis === undefined || mod.basisSidecarPath === undefined) throw new Error('basis-sidecar.ts exports no recordingBasis or basisSidecarPath');
  expect(mod.basisSidecarPath(file)).toBe(`${file}.basis.json`);
  return mod.recordingBasis(file, log);
}

/** The live pipeline options this task adds (see the seam above). */
type BasisOptions = { basis: { rebuild: Pick<RebuildService, 'ensureCurrent'>; lastChoice: Pick<LastChoiceStore, 'read'> } };
type ReplayOptions = { recordedBasis: BasisSidecar | null };

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

export type Feed = {
  push: (packets: Timed) => void;
  seen: Seen[];
  pipeline: FeedPipeline;
  dir: string;
  file: () => string;
  end: () => Promise<string>;
  /** Stops the bridge, not the session (`pipeline.stop()`): its row stays incomplete, for a restart to continue (C59). */
  halt: () => Promise<void>;
};

/**
 * One database, one hub, one `TeamFeeds`, the fake rebuild service and last choice, as `serve` holds them; `routing()`
 * builds the `BasisRouting` over the map of pipelines.
 */
export function bridge(o: { lastChoice?: LastChoice } = {}) {
  const db = openDatabase(join(tmp(), 'live.db'));
  const hub = new TopicHub({ now: () => 0 });
  const published = vi.spyOn(hub, 'publishState');
  const teams = new TeamFeeds();
  const pipelines = new Map<FeedId, FeedPipeline>();
  const rebuild = fakeRebuild(db);
  const lastChoice = fakeLastChoice(o.lastChoice);
  const plans = fakePlans();
  /**
   * A live pipeline of feed `id` on a manual source, its session file and sidecars in `recordingsDir` (default a new temp
   * dir; a restart passes its first run's).
   */
  const feed = (id: FeedId, wallClock: number = AT.race, recordingsDir?: string): Feed => {
    const probe = basisProbe();
    const source = new ManualSource(id);
    const dir = recordingsDir ?? tmp();
    const options: FeedPipelineOptions & BasisOptions = {
      feedId: id,
      source,
      hub,
      features: [probe.feature],
      log,
      teams,
      storage: { db, rulesVersion: RULES, recordingsDir: dir },
      wallClock: () => wallClock,
      basis: { rebuild: rebuild.service, lastChoice },
    };
    const pipeline = new FeedPipeline(options as FeedPipelineOptions);
    pipelines.set(id, pipeline);
    pipeline.start();
    const stop = async (): Promise<void> => {
      await source.stop();
      await pipeline.done;
    };
    stops.push(stop);
    const file = (): string => {
      const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
      expect(files, `feed ${id}: one session file`).toHaveLength(1);
      return join(dir, files[0]!);
    };
    return {
      push: (packets) => {
        for (const { packet, receivedAtMs } of packets) source.push(packetBytes(packet), receivedAtMs);
      },
      seen: probe.seen,
      pipeline,
      dir,
      file,
      /** Ends the feed's session; the path of its session file. */
      end: async () => {
        await stop();
        return file();
      },
      halt: () => pipeline.stop(),
    };
  };
  const routing = async (): Promise<BasisRouting> => {
    const BasisRouting = await basisRoutingClass();
    return new BasisRouting({ teams, pipelines, rebuild: rebuild.service, plans });
  };
  /** The newest `basis.active` value the feed's pipeline published for `id` (C54, C55); none yet: `undefined`. */
  const active = (id: FeedId): BasisActive | undefined => {
    const calls = published.mock.calls.filter(([feed, topic]) => feed === id && topic === 'basis.active');
    return calls.at(-1)?.[2]({}) as BasisActive | undefined;
  };
  return { db, hub, feed, teams, rebuild, lastChoice, plans, routing, active };
}

/**
 * Replays (reprocesses) a session file alone with its sidecars, its basis sessions read from `db` (C38): what the probe saw.
 */
export async function replay(db: Db, file: string, id: FeedId): Promise<Seen[]> {
  const probe = basisProbe();
  const options: FeedPipelineOptions & ReplayOptions = {
    feedId: id,
    source: new PwrecSource({ feedId: id, path: file, mode: 'asFastAsPossible' }),
    hub: new TopicHub({ now: () => 0 }),
    features: [probe.feature],
    log,
    teams: new TeamFeeds(),
    recorded: recordingDecisions(file),
    recordedBasis: await recordingBasisOf(file),
    storage: { db, rulesVersion: RULES, mode: 'replace', sourcePath: file },
  };
  const pipeline = new FeedPipeline(options as FeedPipelineOptions);
  pipeline.start();
  await pipeline.done;
  return probe.seen;
}

/**
 * A replay (reprocess) of a session file with its sidecars and the bridge's rebuild service (SP4.3e Task 7a-2 fix round,
 * F2; C38, C61): `FeedPipelineOptions.basis` beside `recordedBasis`. With `recordedBasis`, `basis.rebuild` makes the
 * sessions the sidecar's `start` names and those of every recorded `basisChosen` current before the run's first frame
 * (`ensureCurrent`, priority `firstRead`), and the run waits for it (C61: every reader but a running session waits at its
 * first read); it never preselects and never commits. Started, not awaited: `done` resolves at the replay's end.
 */
export async function replayWithRebuild(
  db: Db,
  file: string,
  id: FeedId,
  rebuild: Pick<RebuildService, 'ensureCurrent'>,
): Promise<{ seen: Seen[]; done: Promise<void> }> {
  const probe = basisProbe();
  const options: FeedPipelineOptions & ReplayOptions & BasisOptions = {
    feedId: id,
    source: new PwrecSource({ feedId: id, path: file, mode: 'asFastAsPossible' }),
    hub: new TopicHub({ now: () => 0 }),
    features: [probe.feature],
    log,
    teams: new TeamFeeds(),
    recorded: recordingDecisions(file),
    recordedBasis: await recordingBasisOf(file),
    basis: { rebuild, lastChoice: fakeLastChoice() },
    storage: { db, rulesVersion: RULES, mode: 'replace', sourcePath: file },
  };
  const pipeline = new FeedPipeline(options as FeedPipelineOptions);
  pipeline.start();
  return { seen: probe.seen, done: pipeline.done };
}

/** Lets the fake rebuild's promises and what waits on them settle. */
export const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
