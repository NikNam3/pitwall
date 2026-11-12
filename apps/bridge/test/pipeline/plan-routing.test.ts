// SP4.3b Task 17, plan routing across the team's feeds (C1a, C38, C76; spec §8.5). `PlanRouting` (seam: `./plan-seam.ts`)
// hands a plan committed from feed A to every feed in `TeamFeeds.teamOf(A)`, each with its own engine's next frame and
// into its own decisions sidecar, so each recording replays alone. A feed of another team never gets it; a
// `calibrationChosen` stays with its own feed. A feed that joins the team after the commit gets the newest plan of each
// car at its first frame with its team known. Builder sessions on manual sources (live-like); temp dirs only (C84).
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { carId, feedId, known, latestPlan, toSessionTime, type DecisionRecord, type FeedId, type Policy } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { PacketId } from '@pitwall/protocol';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { TeamFeeds } from '../../src/pipeline/team-feeds.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { fakeCalibration } from '../helpers/fake-calibration.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { planRoutingClass, type PlanAction, type PlanRouting } from './plan-seam.ts';

type Timed = ReturnType<ScenarioBuilder['packets']>;

const A = feedId('udp-20777');
const B = feedId('udp-20778');
const C = feedId('udp-20779');
const UID = 7n;
/** Slots 0 and 1 drive for team 3, slots 2 and 3 for team 4. */
const TEAMS = [3, 3, 4, 4] as const;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'plan-routing-'));
const decisionsSidecar = (file: string): string => `${file}.decisions.json`;
type SidecarEntry = { recordIndex: number; decision: { kind: string } & Record<string, unknown> };
const sidecarOf = (file: string): SidecarEntry[] => (existsSync(decisionsSidecar(file)) ? (JSON.parse(readFileSync(decisionsSidecar(file), 'utf8')) as SidecarEntry[]) : []);

/** A plan with one stop on lap `lap` (the builder's race has 10) and its triggers, thresholds included. */
const policyAt = (lap: number): Policy => ({
  stops: [{ lap, compound: 'hard' }],
  triggers: [
    { kind: 'neutralised', condition: 'sc', fromLap: 1, toLap: lap, action: { box: 'medium' } },
    { kind: 'rivalPits', carId: carId(2), withinMs: 1_500, action: 'cover' },
  ],
});
const commit = (from: FeedId, car: number, lap: number): PlanAction => ({ kind: 'plan.commit', feedId: from, carId: carId(car), policy: policyAt(lap) });

/** What the probe saw on one frame: the race clock, the decisions in the projection and the plans of cars 0 and 1. */
type Seen = { at: number; decisions: DecisionRecord[]; plans: [Policy | null, Policy | null] };

/** A unit that keeps what it sees each frame; it reads `feed`, which changes on every frame, so it runs on every frame. */
function planProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.plan-probe',
    reads: ['feed', 'decisions'],
    cadence: 'frame',
    compute: (view) => {
      const history = view.history as unknown as { decisions: readonly DecisionRecord[] };
      const decisions = structuredClone([...history.decisions]);
      seen.push({
        at: view.live.sessionTime,
        decisions,
        // read by the assertions, from the frame's decisions
        get plans(): [Policy | null, Policy | null] {
          return [latestPlan({ decisions }, carId(0)), latestPlan({ decisions }, carId(1))];
        },
      });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'plan-probe', calculators: [calc], topics: [] }), seen };
}

/** A builder session of uid 7 with player car `player`; Participants name every slot's team. */
const builder = (player: number): ScenarioBuilder =>
  new ScenarioBuilder({ sessionUid: UID, cars: TEAMS.length, player }).participants({ participants: TEAMS.map((teamId) => ({ teamId })) });

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

type Feed = { push: (packets: Timed) => void; seen: Seen[]; pipeline: FeedPipeline; end: () => Promise<string> };

/** One hub, one `TeamFeeds`, one `PlanRouting` over the map of pipelines, as `serve` holds them. */
async function bridge() {
  const PlanRouting = await planRoutingClass();
  const hub = new TopicHub({ now: () => 0 });
  const teams = new TeamFeeds();
  const pipelines = new Map<FeedId, FeedPipeline>();
  const routing: PlanRouting = new PlanRouting({ teams, pipelines });
  /** A live-like pipeline on a manual source, writing its session file (and sidecars) to a temp dir. */
  const feed = (id: FeedId, calibration?: ReturnType<typeof fakeCalibration>): Feed => {
    const probe = planProbe();
    const source = new ManualSource(id);
    const dir = tmp();
    const pipeline = new FeedPipeline({
      feedId: id,
      source,
      hub,
      features: [probe.feature],
      log,
      teams,
      storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'live.db')), recordingsDir: dir },
      ...(calibration && { calibration: calibration.store }),
    });
    pipelines.set(id, pipeline);
    pipeline.start();
    const stop = async (): Promise<void> => {
      await source.stop();
      await pipeline.done;
    };
    stops.push(stop);
    return {
      push: (packets) => {
        for (const { packet, receivedAtMs } of packets) source.push(packetBytes(packet), receivedAtMs);
      },
      seen: probe.seen,
      pipeline,
      /** Ends the feed's session; the path of its session file. */
      end: async () => {
        await stop();
        const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
        expect(files).toHaveLength(1);
        return join(dir, files[0]!);
      },
    };
  };
  return { feed, routing, teams };
}

/** The packets of `b` from frame `from` (by the header's frame id) to before `to`. */
const slice = (packets: Timed, from: number, to: number): Timed =>
  packets.filter(({ packet }) => packet.header.frameIdentifier >= from && packet.header.frameIdentifier < to);

/** Replays a session file alone, with its sidecars, and gives what the probe saw. */
async function replay(file: string, id: FeedId): Promise<Seen[]> {
  const probe = planProbe();
  const pipeline = new FeedPipeline({
    feedId: id,
    source: new PwrecSource({ feedId: id, path: file, mode: 'asFastAsPossible' }),
    hub: new TopicHub({ now: () => 0 }),
    features: [probe.feature],
    log,
    teams: new TeamFeeds(),
    recorded: recordingDecisions(file),
  });
  pipeline.start();
  await pipeline.done;
  return probe.seen;
}

const last = (seen: readonly Seen[]): Seen => seen.at(-1)!;
/** The plans per frame, by race-clock time: what a replay must agree with its live run on. */
const plansPerFrame = (seen: readonly Seen[]) => seen.map((s) => [s.at, JSON.stringify(s.plans)]);

/**
 * Feeds A (player car 0) and B (player car 1) of team 3: A runs 8 frames, B 5, then A commits a plan for car 0 and
 * both run 6 frames more. Each commit lands on its engine's next frame, so A's describes a frame 3 later than B's.
 */
async function twoFeedsWithCommit() {
  const b = await bridge();
  const a = b.feed(A);
  const bb = b.feed(B);
  const packetsA = builder(0).frames(20, () => {}).packets();
  const packetsB = builder(1).frames(20, () => {}).packets();
  a.push(slice(packetsA, 0, 8));
  bb.push(slice(packetsB, 0, 5));
  expect([...b.teams.teamOf(A)].sort()).toEqual([A, B]);
  const answer = b.routing.commit(commit(A, 0, 6));
  a.push(slice(packetsA, 8, 14));
  bb.push(slice(packetsB, 5, 11));
  return { answer, a, bb, fileA: await a.end(), fileB: await bb.end() };
}

describe('plan routing to the team\'s feeds (C1a, C76)', () => {
  it('two feeds of one team: a commit in feed A is appended in both logs, each at its engine\'s current frame, and written to both sidecars', async () => {
    const { answer, a, bb, fileA, fileB } = await twoFeedsWithCommit();
    expect(answer).toEqual({ ok: true });
    const decision = { kind: 'planCommitted', carId: 0, policy: policyAt(6), frame: expect.any(Number) };
    expect(last(a.seen).decisions).toEqual([decision]);
    expect(last(bb.seen).decisions).toEqual([decision]);
    expect(last(a.seen).plans).toEqual([policyAt(6), null]);
    expect(last(bb.seen).plans).toEqual([policyAt(6), null]);
    // each at its own engine's next frame: A had applied 3 frames more than B
    expect(last(a.seen).decisions[0]!.frame - last(bb.seen).decisions[0]!.frame).toBe(3);
    // and each in its own decisions sidecar, with its own record index
    const sidecarA = sidecarOf(fileA);
    const sidecarB = sidecarOf(fileB);
    expect(sidecarA.map((e) => e.decision)).toEqual([{ kind: 'planCommitted', carId: 0, policy: policyAt(6) }]);
    expect(sidecarB.map((e) => e.decision)).toEqual([{ kind: 'planCommitted', carId: 0, policy: policyAt(6) }]);
    expect(sidecarA[0]!.recordIndex).toBeGreaterThan(sidecarB[0]!.recordIndex);
  });

  it('each of the two recordings replayed alone gives the same latestPlan per frame as its live run', async () => {
    const { a, bb, fileA, fileB } = await twoFeedsWithCommit();
    expect(last(a.seen).decisions).toHaveLength(1);
    const replayA = await replay(fileA, A);
    const replayB = await replay(fileB, B);
    expect(plansPerFrame(replayA)).toEqual(plansPerFrame(a.seen));
    expect(plansPerFrame(replayB)).toEqual(plansPerFrame(bb.seen));
    expect(last(replayA).decisions).toEqual(last(a.seen).decisions);
    expect(last(replayB).decisions).toEqual(last(bb.seen).decisions);
  });

  it('a feed of another team never gets it; a calibrationChosen stays with its own feed', async () => {
    const b = await bridge();
    const cal = fakeCalibration([{ trackId: 0, id: 'dry', name: 'Dry', sources: 1, entries: { 'pitLoss.ms.green': known(21_000, toSessionTime(0)) } }]);
    const a = b.feed(A, cal);
    const bb = b.feed(B);
    // C: the same session, player car 2 of team 4
    const c = b.feed(C);
    const packets = [builder(0), builder(1), builder(2)].map((s) => s.frames(20, () => {}).packets());
    a.push(slice(packets[0]!, 0, 6));
    bb.push(slice(packets[1]!, 0, 6));
    c.push(slice(packets[2]!, 0, 6));
    expect([...b.teams.teamOf(C)]).toEqual([C]);
    expect(b.routing.commit(commit(A, 1, 5))).toEqual({ ok: true });
    expect(a.pipeline.commitDecision('dry')).toEqual({ ok: true });
    a.push(slice(packets[0]!, 6, 12));
    bb.push(slice(packets[1]!, 6, 12));
    c.push(slice(packets[2]!, 6, 12));
    const [fileA, fileB, fileC] = [await a.end(), await bb.end(), await c.end()];
    expect(last(a.seen).decisions.map((d) => d.kind).sort()).toEqual(['calibrationChosen', 'planCommitted']);
    expect(last(bb.seen).decisions.map((d) => d.kind)).toEqual(['planCommitted']);
    expect(last(bb.seen).plans).toEqual([null, policyAt(5)]);
    expect(c.seen.length).toBeGreaterThan(0);
    for (const s of c.seen) expect(s).toMatchObject({ decisions: [], plans: [null, null] });
    expect(sidecarOf(fileA).map((e) => e.decision.kind).sort()).toEqual(['calibrationChosen', 'planCommitted']);
    expect(sidecarOf(fileB).map((e) => e.decision.kind)).toEqual(['planCommitted']);
    expect(sidecarOf(fileC)).toEqual([]);
  });

  it('a feed that joins the team after the commit gets the newest plan at its first frame with its team known', async () => {
    const b = await bridge();
    const a = b.feed(A);
    const packetsA = builder(0).frames(30, () => {}).packets();
    a.push(slice(packetsA, 0, 6));
    // A alone commits for car 0, replaces it, and commits for car 1
    expect(b.routing.commit(commit(A, 0, 4))).toEqual({ ok: true });
    a.push(slice(packetsA, 6, 8));
    expect(b.routing.commit(commit(A, 0, 7))).toEqual({ ok: true });
    a.push(slice(packetsA, 8, 10));
    expect(b.routing.commit(commit(A, 1, 9))).toEqual({ ok: true });
    a.push(slice(packetsA, 10, 12));
    expect(last(a.seen).plans).toEqual([policyAt(7), policyAt(9)]);

    // B's session starts without Participants (the builder's leading one is dropped); they arrive with its frame 5
    const bb = b.feed(B);
    const later = builder(1).frames(5, () => {}).participants({ participants: TEAMS.map((teamId) => ({ teamId })) }).frames(5, () => {}).packets();
    const firstParticipants = later.findIndex(({ packet }) => packet.packetId === PacketId.participants);
    const secondParticipants = later.findIndex(({ packet }, i) => i > firstParticipants && packet.packetId === PacketId.participants);
    bb.push(later.slice(0, secondParticipants).filter((_, i) => i !== firstParticipants));
    expect([...b.teams.teamOf(B)]).toEqual([B]);
    expect(bb.seen.every((s) => s.decisions.length === 0)).toBe(true);
    const before = bb.seen.length;

    bb.push(later.slice(secondParticipants));
    expect([...b.teams.teamOf(B)].sort()).toEqual([A, B]);
    // the newest plan decision of each car, both on B's first frame with its team known
    const joined = bb.seen[before]!;
    expect(joined.plans).toEqual([policyAt(7), policyAt(9)]);
    expect(joined.decisions).toHaveLength(2);
    expect(new Set(joined.decisions.map((d) => d.frame)).size).toBe(1);
    expect(bb.seen.slice(before).every((s) => JSON.stringify(s.plans) === JSON.stringify(joined.plans))).toBe(true);
    // A's log is unchanged by B joining
    expect(last(a.seen).decisions).toHaveLength(3);
    // and B's sidecar holds them, so its recording replays alone
    const fileB = await bb.end();
    expect(sidecarOf(fileB).map((e) => [e.decision.kind, e.decision['carId']]).sort()).toEqual([['planCommitted', 0], ['planCommitted', 1]]);
    const replayB = await replay(fileB, B);
    expect(plansPerFrame(replayB)).toEqual(plansPerFrame(bb.seen));
  });
});
