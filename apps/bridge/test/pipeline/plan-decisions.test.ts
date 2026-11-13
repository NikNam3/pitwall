// SP4.3b Task 17, the plan decision in one feed (C10, C27a, C29, C38, C73, C76; spec §8.2). A `plan.commit` through the
// bridge's `PlanRouting` (seam: `./plan-seam.ts`) reaches the running session with its next frame as `planCommitted
// { carId, policy }`, the policy whole, and the decisions sidecar with its record index; `latestPlan` reads it from the
// projection. A replay feeds the sidecar back at the record index and gives the same plan on every frame. A plan whose
// stop lies past the race's laps is rejected and never stored (C73). A flashback past the commit voids it (C27a); a
// commit during the formation lap stays visible (C29). Real segments (C84); temp dirs only.
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { latestPlan, sessionPhaseRaceSpans, type CarId, type DecisionRecord, type FeedId, type Policy } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { PwrecSource } from '../../src/input/pwrec-source.ts';
import { createLogger } from '../../src/log.ts';
import { recordingDecisions, type RecordedRun } from '../../src/pipeline/decision-sidecars.ts';
import { FeedPipeline, type DecisionResult } from '../../src/pipeline/feed-pipeline.ts';
import { TeamFeeds } from '../../src/pipeline/team-feeds.ts';
import { openDatabase } from '../../src/storage/db.ts';
import { HookedSource } from '../helpers/hooked-source.ts';
import { segmentPath } from '../fixtures/replay.ts';
import { planRoutingClass, type PlanAction } from './plan-seam.ts';

const F = 'plan' as FeedId;
const LAP10 = segmentPath('race-zandvoort-lap10.pwrec.gz');
const FLASHBACK = segmentPath('race-singapore-wet-flashback.pwrec.gz');
const WET_START = segmentPath('race-singapore-wet-start.pwrec.gz');
/** The records of LAP10 (1778 records) after which the live run commits, and later replaces and clears, a plan. */
const COMMIT_AT = 600;
const REPLACE_AT = 1_000;
const CLEAR_AT = 1_400;
const PHASE = sessionPhaseRaceSpans.machine;
const log = createLogger({ level: 'silent' });
const tmp = () => mkdtempSync(join(tmpdir(), 'plan-decisions-'));
const decisionsSidecar = (file: string): string => `${file}.decisions.json`;
const decisionsOf = (file: string): unknown => (existsSync(decisionsSidecar(file)) ? JSON.parse(readFileSync(decisionsSidecar(file), 'utf8')) : []);

/** A plan with one stop on lap `lap` and a trigger of every kind, thresholds included: the decision carries it whole. */
const policyAt = (lap: number, compound: 'medium' | 'hard' = 'hard'): Policy => ({
  stops: [{ lap, compound }],
  triggers: [
    { kind: 'neutralised', condition: 'sc', fromLap: 1, toLap: lap, action: { box: 'medium' } },
    { kind: 'rain', wetnessMs: 4_000, action: { box: 'inter' } },
    { kind: 'rivalPits', carId: 3 as CarId, withinMs: 1_500, action: 'cover' },
    { kind: 'degradationOff', wearRateDeltaPct: 20, action: { switchTo: [{ lap, compound: 'medium' }] } },
    { kind: 'damage', lossMsPerLap: 800, action: { box: 'hard' } },
  ],
});

/** What the probe saw on one frame: the race clock, the open session phase, the race's laps, our car, its plan and the decisions. */
type Seen = { at: number; phase: string | undefined; totalLaps: number; player: CarId; plan: Policy | null; decisions: DecisionRecord[] };

/** A unit that keeps what it sees each frame; it reads `feed`, which changes on every frame, so it runs on every frame. */
function planProbe(): { feature: Feature; seen: Seen[] } {
  const seen: Seen[] = [];
  const calc: QuickCalculator<number> = {
    kind: 'quick',
    id: 'test.plan-probe',
    reads: ['feed', 'decisions', 'spans:session-phase-race'],
    cadence: 'frame',
    compute: (view) => {
      const player = view.live.playerCar as CarId;
      const history = view.history as unknown as { decisions: readonly DecisionRecord[] };
      const decisions = structuredClone([...history.decisions]);
      seen.push({
        at: view.live.sessionTime,
        phase: view.situation.byMachine[PHASE]?.[0]?.kind,
        totalLaps: view.live.session.totalLaps,
        player,
        decisions,
        // read by the assertions, from the frame's decisions
        get plan() {
          return latestPlan({ decisions }, player);
        },
      });
      return seen.length;
    },
  };
  return { feature: defineFeature({ name: 'plan-probe', calculators: [calc], topics: [] }), seen };
}

/** A commit after the first record for which `when` holds; `action` builds it from what the probe saw so far. */
type Commit = { when: (index: number, seen: readonly Seen[]) => boolean; action: (seen: readonly Seen[]) => PlanAction };
type RunOptions = { recorded?: RecordedRun; record?: boolean; commits?: Commit[] };
type Run = { seen: Seen[]; file: string | undefined; answers: DecisionResult[] };

/** Runs `path` through one pipeline with the probe; the commits go through `PlanRouting` between two records, as a click does. */
async function run(path: string, o: RunOptions = {}): Promise<Run> {
  const PlanRouting = await planRoutingClass();
  const probe = planProbe();
  let nowMs = 0;
  const hub = new TopicHub({ now: () => nowMs });
  const teams = new TeamFeeds();
  const pipelines = new Map<FeedId, FeedPipeline>();
  const routing = new PlanRouting({ teams, pipelines });
  const dir = o.record === true ? tmp() : undefined;
  const pending = [...(o.commits ?? [])];
  const answers: DecisionResult[] = [];
  const source = new HookedSource(new PwrecSource({ feedId: F, path, mode: 'asFastAsPossible' }), {
    before: (packet) => {
      nowMs = packet.receivedAtMs;
    },
    after: (index) => {
      hub.tick();
      const next = pending[0];
      if (next !== undefined && next.when(index, probe.seen)) {
        pending.shift();
        answers.push(routing.commit(next.action(probe.seen)));
      }
    },
  });
  const pipeline = new FeedPipeline({
    feedId: F,
    source,
    hub,
    features: [probe.feature],
    log,
    teams,
    ...(o.recorded && { recorded: o.recorded }),
    ...(dir !== undefined && { storage: { rulesVersion: 'unversioned', db: openDatabase(join(tmp(), 'live.db')), recordingsDir: dir } }),
  });
  pipelines.set(F, pipeline);
  pipeline.start();
  await pipeline.done;
  expect(pending, 'every commit happened').toEqual([]);
  let file: string | undefined;
  if (dir !== undefined) {
    const files = readdirSync(dir).filter((name) => name.endsWith('.pwrec.gz'));
    expect(files).toHaveLength(1);
    file = join(dir, files[0]!);
  }
  return { seen: probe.seen, file, answers };
}

const last = (seen: readonly Seen[]): Seen => seen.at(-1)!;
const commitOf = (lap: (s: Seen) => number, compound?: 'medium' | 'hard') => (seen: readonly Seen[]): PlanAction =>
  ({ kind: 'plan.commit', feedId: F, carId: last(seen).player, policy: policyAt(lap(last(seen)), compound) });
const clearOf = (seen: readonly Seen[]): PlanAction => ({ kind: 'plan.clear', feedId: F, carId: last(seen).player });
const atRecord = (record: number) => (index: number) => index === record - 1;
/** The plan per frame, by race-clock time: what two runs must agree on. */
const plansPerFrame = (seen: readonly Seen[]) => seen.map((s) => [s.at, JSON.stringify(s.plan)]);

describe('a plan committed in a live run (C10, C76)', () => {
  let live: Run;
  beforeAll(async () => {
    live = await run(LAP10, {
      record: true,
      commits: [
        { when: atRecord(COMMIT_AT), action: commitOf((s) => Math.min(2, s.totalLaps)) },
        { when: atRecord(REPLACE_AT), action: commitOf((s) => s.totalLaps, 'medium') },
        { when: atRecord(CLEAR_AT), action: clearOf },
      ],
    });
  }, 60_000);

  it('a committed plan is recorded at its frame, with its whole policy, and latestPlan returns it', () => {
    expect(live.answers[0]).toEqual({ ok: true });
    const first = live.seen.findIndex((s) => s.decisions.length === 1);
    expect(first).toBeGreaterThan(0);
    const s = live.seen[first]!;
    const policy = policyAt(Math.min(2, s.totalLaps));
    expect(s.decisions).toEqual([{ kind: 'planCommitted', carId: s.player, policy, frame: expect.any(Number) }]);
    expect(s.plan).toEqual(policy);
    // no plan before its frame
    expect(live.seen.slice(0, first).every((x) => x.plan === null && x.decisions.length === 0)).toBe(true);
    // the decisions sidecar holds it with its record index, the policy whole
    const sidecar = decisionsOf(live.file!) as Array<{ recordIndex: number; decision: unknown }>;
    expect(sidecar[0]).toEqual({ recordIndex: expect.any(Number), decision: { kind: 'planCommitted', carId: s.player, policy } });
    expect(Number.isInteger(sidecar[0]!.recordIndex) && sidecar[0]!.recordIndex >= 0).toBe(true);
  });

  it('a later commit replaces it; planCleared makes latestPlan null', () => {
    expect(live.answers).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const replaced = live.seen.findIndex((s) => s.decisions.length === 2);
    const cleared = live.seen.findIndex((s) => s.decisions.length === 3);
    expect(replaced).toBeGreaterThan(0);
    expect(cleared).toBeGreaterThan(replaced);
    const s = live.seen[replaced]!;
    expect(s.plan).toEqual(policyAt(s.totalLaps, 'medium'));
    expect(live.seen.slice(replaced, cleared).every((x) => JSON.stringify(x.plan) === JSON.stringify(s.plan))).toBe(true);
    expect(live.seen[cleared]!.decisions.at(-1)).toEqual({ kind: 'planCleared', carId: s.player, frame: expect.any(Number) });
    expect(live.seen.slice(cleared).every((x) => x.plan === null)).toBe(true);
    // each decision describes a later frame than the one before
    const frames = last(live.seen).decisions.map((d) => d.frame);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    expect(new Set(frames).size).toBe(3);
    expect((decisionsOf(live.file!) as unknown[]).map((e) => (e as { decision: { kind: string } }).decision.kind)).toEqual(['planCommitted', 'planCommitted', 'planCleared']);
  });

  it('a replay feeds the sidecar back at the record index (C76): same latestPlan per frame as live', async () => {
    const recorded = recordingDecisions(live.file!);
    expect(recorded.decisions).toHaveLength(3);
    const replay = await run(live.file!, { recorded });
    expect(plansPerFrame(replay.seen)).toEqual(plansPerFrame(live.seen));
    expect(last(replay.seen).decisions).toEqual(last(live.seen).decisions);
  }, 60_000);
});

describe('an invalid plan (C73)', () => {
  it('an invalid policy is rejected and never stored', async () => {
    // a stop one lap past the race's laps: the range the decoder cannot check
    const live = await run(LAP10, { record: true, commits: [{ when: atRecord(COMMIT_AT), action: commitOf((s) => s.totalLaps + 1) }] });
    expect(live.answers).toEqual([{ ok: false, reason: 'invalid', message: expect.stringMatching(/\S/) }]);
    expect(decisionsOf(live.file!)).toEqual([]);
    expect(live.seen.length).toBeGreaterThan(0);
    for (const s of live.seen) expect(s).toMatchObject({ plan: null, decisions: [] });
  }, 60_000);
});

describe('a flashback and a plan (C27a)', () => {
  it('a flashback past the commit voids it (C27a)', async () => {
    // the segment's first pass runs 741.5 to 744.5 s, the flashback goes back to 742.045 s: a commit 2 s into the first
    // pass lies after the rewind's target
    const live = await run(FLASHBACK, {
      commits: [{ when: (_index, seen) => seen.length > 0 && last(seen).at >= seen[0]!.at + 2_000, action: commitOf((s) => Math.min(2, s.totalLaps)) }],
    });
    expect(live.answers).toEqual([{ ok: true }]);
    // the commit took effect before the rewind, and after it the decision never happened
    expect(live.seen.some((s) => s.plan !== null)).toBe(true);
    expect(last(live.seen)).toMatchObject({ plan: null, decisions: [] });
  }, 60_000);
});

describe('a plan and the formation lap (C29)', () => {
  it('a commit during the formation lap stays visible (C29)', async () => {
    // the segment holds the formation start, the formation-end reset, the start lights and lights out
    const live = await run(WET_START, {
      commits: [{ when: (_index, seen) => seen.at(-1)?.phase === 'formation', action: commitOf((s) => Math.min(2, s.totalLaps)) }],
    });
    expect(live.answers).toEqual([{ ok: true }]);
    const first = live.seen.findIndex((s) => s.decisions.length === 1);
    expect(first).toBeGreaterThan(0);
    // the decision describes a frame of the formation lap and is never hidden by it (C29)
    expect(live.seen[first]!.phase).toBe('formation');
    // the committing car's plan (the formation-end reset sends one frame with another player car index: Task 17 port)
    const committer = (live.seen[first]!.decisions[0] as { carId: CarId }).carId;
    const planOf = (s: Seen) => latestPlan({ decisions: s.decisions }, committer);
    expect(live.seen.slice(first).every((s) => s.decisions.length === 1 && planOf(s) !== null)).toBe(true);
    // and it still counts after lights out
    const racing = live.seen.filter((s) => s.phase === 'racing');
    expect(racing.length).toBeGreaterThan(0);
    for (const s of racing) expect(planOf(s)).toEqual(policyAt(Math.min(2, s.totalLaps)));
  }, 60_000);
});
