// Lights out after a formation lap changes nothing for the readers (C29): the formation lap's facts are hidden, never
// discarded, so no calculator restarts and a calculator compares its first output after lights out with the one before
// it. A fall of the session time that is no start, and a forward jump of more than 60 s that is no post-session jump,
// change nothing and are logged (spec 3.3); after a fall the feed's own insights are timed on the race clock.
// Calculators see the closed session phases in their history (`spans`, C20).
import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { IncrementalCalculator, QuickCalculator } from '@pitwall/engine';
import { packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { beats, FIRST_LIGHT as GRID_FIRST_LIGHT, gridStart, LGOT, scriptPackets, status, STEP, stlg, type Beat } from '../../../../packages/engine/test/situations/script.ts';
import { bindInsights, defineFeature, type Feature } from '../../src/features/feature.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ManualSource } from '../helpers/manual-source.ts';

const F = 'test' as FeedId;
const FTLP = { code: 'FTLP', vehicleIdx: 0, lapTime: 80 } as const;

type Prepared = Array<{ bytes: Uint8Array; receivedAtMs: number; frameId: number }>;
const prepared = (beatList: Beat[]): Prepared =>
  scriptPackets(beatList).map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs, frameId: packet.header.frameIdentifier }));

/** Frame of the lights out. */
const LIGHTS_OUT = 50;
/** Frame of the first start light, on the clock held at 0 since frame 40. */
const FIRST_LIGHT = 42;
/**
 * The grid from 0 s, the formation status at frame 5, a fastest lap in the formation (frame 20, at 0.32 s) unless
 * `fastestLap` is false, the clock reset to 0 at frame 40 and held, five start lights at frames 42-46, lights out at
 * frame 50, the race from 0.016 s to frame 89.
 */
const formationStart = (fastestLap = true): { before: Prepared; after: Prepared } => {
  const all = prepared(beats(90, (k) => ({
    at: k < 40 ? k * STEP : k <= LIGHTS_OUT ? 0 : (k - LIGHTS_OUT) * STEP,
    ...(k === 5 && { session: status(3) }),
    ...(k === 44 && { session: status(0) }),
    events: [...(fastestLap && k === 20 ? [FTLP] : []), ...(k >= 42 && k <= 46 ? [stlg(k - 41)] : []), ...(k === LIGHTS_OUT ? [LGOT] : [])],
  })));
  return { before: all.filter((p) => p.frameId < LIGHTS_OUT), after: all.filter((p) => p.frameId >= LIGHTS_OUT) };
};

/** A pipeline of `features` on a manual source, one client that records what it receives, and the log lines. */
function setup(features: Feature[], staleCheck?: { clock: () => number; everyMs: number }) {
  let pipeline: FeedPipeline | undefined = undefined;
  const hub = new TopicHub({ now: () => 0, onDemandChange: () => pipeline?.demandChanged() });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  const source = new ManualSource(F);
  const lines: Array<Record<string, unknown>> = [];
  const destination = new Writable({ write(chunk, _encoding, done) { lines.push(JSON.parse(String(chunk)) as Record<string, unknown>); done(); } });
  pipeline = new FeedPipeline({ feedId: F, source, hub, features, log: createLogger({ level: 'info', destination }), ...(staleCheck && { staleCheck }) });
  pipeline.start();
  const push = (chunk: Prepared) => chunk.forEach((p) => source.push(p.bytes, p.receivedAtMs));
  return { hub, pipeline, inbox, push, lines };
}

/** An incremental calculator on the events that notes the frame of every `init`. */
const initProbe = (inits: number[]): IncrementalCalculator<number, number> => ({
  kind: 'incremental', id: 'probe.events', reads: ['events'], cadence: 'frame',
  init: ({ live, history }) => { inits.push(live.lastFrameId); return history.events.length; },
  update: (n, delta) => n + (delta.after.events ?? 0) - (delta.before.events ?? 0),
  output: (n) => n,
});

describe('FeedPipeline: lights out after a formation lap restarts no calculator (C29)', () => {
  it('an incremental calculator starts from init once, on its first frame, and never again: not at the first start light, not at lights out', async () => {
    const inits: number[] = [];
    const { pipeline, push } = setup([defineFeature({ name: 'probe-events', calculators: [initProbe(inits)], topics: [] })]);
    const { before, after } = formationStart();
    push(before);
    push(after);
    await pipeline.stop();
    // The reset at frame 40 is carried over (C36); the formation's fastest lap (frame 20) is hidden by the formation
    // span, never discarded: nothing rewinds.
    expect(inits).toHaveLength(1);
    expect(inits[0]).toBeLessThan(FIRST_LIGHT);
  });
  it('without an entry in the formation, too, the only init is the first', async () => {
    const inits: number[] = [];
    const { pipeline, push } = setup([defineFeature({ name: 'probe-events', calculators: [initProbe(inits)], topics: [] })]);
    const { before, after } = formationStart(false);
    push(before);
    push(after);
    await pipeline.stop();
    expect(inits).toHaveLength(1);
  });
  it('a calculator compares its first output after lights out with the one before it', async () => {
    const seen = new Map<number, number | undefined>();
    const clock: QuickCalculator<number> = {
      kind: 'quick', id: 'probe.clock', reads: ['timing'], cadence: 'frame',
      compute: ({ live }) => live.sessionTime,
      insights: (_out, prev, { live }) => { seen.set(live.lastFrameId, prev); return []; },
    };
    const { pipeline, push } = setup([defineFeature({ name: 'probe-clock', calculators: [clock], topics: [] })]);
    const { before, after } = formationStart();
    push(before);
    push(after);
    await pipeline.stop();
    expect([seen.has(LIGHTS_OUT), seen.get(LIGHTS_OUT) !== undefined]).toEqual([true, true]);
  });
});

describe('FeedPipeline: the session phases in the view', () => {
  it('a calculator sees the closed spans of session-phase-race in its history as they close: the grid, the formation, the start lights', async () => {
    const seen = new Map<number, string[]>();
    const probe: QuickCalculator<number> = {
      kind: 'quick', id: 'probe.phase', reads: ['timing'], cadence: 'frame',
      compute: ({ live, history }) => { seen.set(live.lastFrameId, (history.spans['session-phase-race'] ?? []).map((s) => s.kind)); return 0; },
    };
    const { pipeline, push } = setup([defineFeature({ name: 'probe-phase', calculators: [probe], topics: [] })]);
    const { before, after } = formationStart();
    push(before);
    push(after);
    await pipeline.stop();
    expect([seen.get(10), seen.get(45), seen.get(LIGHTS_OUT + 10)]).toEqual([['grid'], ['grid', 'formation'], ['grid', 'formation', 'startLights']]);
  });
});

describe('FeedPipeline: a fall of the session time that is no start', () => {
  it('is logged with the session uid and both times, and the calculators carry on (no restart)', async () => {
    const inits: number[] = [];
    const { pipeline, push, lines } = setup([defineFeature({ name: 'probe-events', calculators: [initProbe(inits)], topics: [] })]);
    // lights out at frame 59, the race clock from 0.016 s; at race frame 150 the clock falls from 2.4 s to 1 s
    push(prepared(gridStart(200, (k) => (k >= 150 ? { at: 1000 + (k - 150) * STEP } : {}))));
    await pipeline.stop();
    expect(lines.filter((l) => l['clockFall'] !== undefined)).toMatchObject([{ sessionUid: expect.any(String), clockFall: { fromMs: 2400, toMs: 1000 } }]);
    // No restart: neither lights out nor the fall rewinds.
    expect(inits).toHaveLength(1);
    expect(inits[0]).toBeLessThan(GRID_FIRST_LIGHT);
  });
});

describe('FeedPipeline: a forward jump of the session time over 60 s that is no post-session jump', () => {
  it('is logged with the session uid and both times, and the calculators carry on (no restart)', async () => {
    const inits: number[] = [];
    const { pipeline, push, lines } = setup([defineFeature({ name: 'probe-events', calculators: [initProbe(inits)], topics: [] })]);
    // lights out at frame 59, the race clock from 0.016 s; at race frame 150, after a 3 s stall, the clock jumps from
    // 2.4 s to 92.416 s (90 s ahead): too little for the post-session simulation (60 times the 3 s)
    push(prepared(gridStart(200, (k) => (k >= 150 ? { at: (k + 1) * STEP + 90_000, wall: (60 + k) * STEP + 3_000 } : {}))));
    await pipeline.stop();
    expect(lines.filter((l) => l['clockJump'] !== undefined)).toMatchObject([{ sessionUid: expect.any(String), clockJump: { fromMs: 2400, toMs: 92_416 } }]);
    expect(lines.filter((l) => l['clockFall'] !== undefined)).toEqual([]);
    // No restart: neither lights out nor the jump rewinds.
    expect(inits).toHaveLength(1);
    expect(inits[0]).toBeLessThan(GRID_FIRST_LIGHT);
  });
});

// Review 3 E6: the race clock reaches the bridge. After a mid-race fall the engine times every entry on its race clock
// (spec 3.3), so the feed's own insights (here feed.stale) are timed on it too, not on the game's raw session time.
describe('FeedPipeline: the feed insights after a mid-race fall of the session time', () => {
  it('a feed.stale raised after the fall carries a time on the race clock, not the raw session time', async () => {
    let now = 0;
    const { hub, pipeline, push, inbox } = setup([defineFeature({ name: 'insights', calculators: [], topics: [bindInsights('insights')] })], { clock: () => now, everyMs: 5 });
    hub.subscribe({ clientId: 'c', id: 'i', topic: 'insights', params: {}, feedId: F });
    // the clock falls at race frame 150 from 2.4 s to 1 s (race clock offset 1.4 s): the frames after the fall lie at
    // raw 1 to 1.784 s, and at 2.4 to 3.184 s on the race clock
    const frames = prepared(gridStart(200, (k) => (k >= 150 ? { at: 1000 + (k - 150) * STEP } : {})));
    push(frames);
    now = frames.at(-1)!.receivedAtMs + 5_000;
    const raisedAt = () => inbox.flatMap((m) => ('entries' in m ? ((m.entries ?? []) as Array<{ type: string; insight?: { kind: string; raisedAt: number } }>) : []))
      .flatMap((e) => (e.type === 'raised' && e.insight?.kind === 'feed.stale' ? [e.insight.raisedAt] : []));
    await vi.waitFor(() => expect(raisedAt()).toHaveLength(1));
    await pipeline.stop();
    expect(raisedAt()[0]).toBeGreaterThanOrEqual(2_400);
    expect(raisedAt()[0]).toBeLessThanOrEqual(3_184);
  });
});
