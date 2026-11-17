// SP4.3d2 final review F2 (C52 as changed: the bridge raises `feed` insights for "feed health within a session;
// between sessions none"; ruling R36; SP4.3d spec §9.2): between sessions no feed insight is raised, a wrong-format
// datagram included, and a feed insight active at the session's end is cleared at the end. Within a session packet loss
// and a wrong format still raise.
//
// A live pipeline on a `ManualSource` whose stale timer reads the test's receive clock ends a builder session by its
// SEND grace window (Task 3's timer). Packet loss: every fourth frame lacks its Motion packet (an incomplete frame).
import { describe, expect, it, vi } from 'vitest';
import type { FeedStatus, ServerMessage } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import { PacketId } from '@pitwall/protocol';
import { ScenarioBuilder, buildPacket, headerFor, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { feedInsights } from '../../src/features/feed-status/feed-status.ts';
import feedStatusFeature from '../../src/features/feed-status/register.ts';
import insightsFeature from '../../src/features/insights/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedAlerts } from '../../src/pipeline/feed-alerts.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ManualSource } from '../helpers/manual-source.ts';
import { viewFrom } from '../helpers/view.ts';

const F = 'live' as FeedId;
const GRACE_MS = 10_000;
const TICK_MS = 5;
const wrongFormat = (): Uint8Array => packetBytes(buildPacket('session', { header: headerFor('session', { packetFormat: 2024 }) }));

/** A session of 200 frames, every fourth without its Motion packet (25 % incomplete frames), ending with SEND. */
const lossySession = (uid: bigint) => new ScenarioBuilder({ sessionUid: uid, cars: 2 }).session().participants()
  .frames(200, (f, i) => { if (i % 4 === 0) f.drop('motion'); })
  .event({ code: 'SEND' })
  .packets();

type Entry = { type: string; key?: string; insight?: { kind: string } };

/** A live pipeline; the window keeps the last `feed.status` and every insight entry. */
function liveRun() {
  let hubNow = 0;
  const hub = new TopicHub({ now: () => (hubNow += 1000) });
  const entries: Entry[] = [];
  let status: FeedStatus | undefined;
  hub.addClient('window', {
    send: (m: ServerMessage) => {
      if (!('id' in m)) return;
      if (m.id === 'insights' && 'entries' in m && m.entries !== undefined) entries.push(...(m.entries as Entry[]));
      if (m.id === 'feed.status' && (m.type === 'snapshot' || m.type === 'update')) status = m.value as FeedStatus;
    },
    bufferedAmount: () => 0,
  });
  for (const topic of ['insights', 'feed.status'] as const) hub.subscribe({ clientId: 'window', id: topic, topic, params: {}, feedId: F });
  let now = 0;
  const source = new ManualSource(F);
  const pipeline = new FeedPipeline({
    feedId: F, source, hub, features: [insightsFeature, feedStatusFeature], log: createLogger({ level: 'silent' }),
    wallClock: () => 0, staleCheck: { clock: () => now, everyMs: TICK_MS },
  });
  pipeline.start();
  const push = (bytes: Uint8Array, atMs: number) => { now = atMs; source.push(bytes, atMs); };
  /** Builder packets, the first at `firstAtMs`. */
  const play = (packets: ReturnType<typeof lossySession>, firstAtMs: number): number => {
    const base = firstAtMs - packets[0]!.receivedAtMs;
    for (const { packet, receivedAtMs } of packets) push(packetBytes(packet), base + receivedAtMs);
    return now;
  };
  const raised = (kind: string): number => entries.filter((e) => e.type === 'raised' && e.insight?.kind === kind).length;
  const resolved = (key: string): number => entries.filter((e) => e.type === 'resolved' && e.key === key).length;
  return { pipeline, push, play, setNow: (ms: number) => { now = ms; }, status: () => status, entries, raised, resolved };
}

describe('feedInsights between sessions (final review F2; C52)', () => {
  const frames = new ScenarioBuilder({ cars: 2 }).session().participants().frames(3, () => {}).build();
  const feed = (o: object) => viewFrom(frames, o).feed;
  const bad = { msSinceLastPacket: 3000, lossPercent: 50, wrongFormat: 2023 };

  it('between sessions: no feed insight', () => {
    expect(feedInsights(F, feed(bad), 0, true)).toEqual([]);
  });
  it('within a session: stale, packet loss and wrong format', () => {
    expect(feedInsights(F, feed(bad), 0, false).map((i) => i.key)).toEqual(['feed.stale', 'feed.packetLoss', 'feed.wrongFormat']);
  });
  it('an insight active at the session end is cleared once between sessions', () => {
    const alerts = new FeedAlerts(F);
    expect(alerts.feedChanged(feed({ lossPercent: 50 }), 10)).toEqual([expect.objectContaining({ type: 'raised' })]);
    expect(alerts.feedChanged(feed({ lossPercent: 50, wrongFormat: 2024 }), 20, true)).toEqual([{ type: 'resolved', key: 'feed.packetLoss', at: 20 }]);
    expect(alerts.active).toEqual([]);
  });
});

describe('the pipeline raises no feed insight between sessions (final review F2; C52)', { timeout: 60_000 }, () => {
  it('between sessions', async () => {
    const run = liveRun();
    const last = run.play(lossySession(77n), 1000);
    // within the session: packet loss raises
    expect(run.raised('feed.packetLoss')).toBe(1);
    // the timer ends the session: the packet loss that held is cleared at the end
    run.setNow(last + GRACE_MS + 1000);
    await vi.waitFor(() => expect(run.status()).toMatchObject({ betweenSessions: true }), { timeout: 5000 });
    expect(run.resolved('feed.packetLoss')).toBe(1);
    // a wrong-format datagram between sessions raises nothing
    run.push(wrongFormat(), last + GRACE_MS + 2000);
    await new Promise((resolve) => setTimeout(resolve, TICK_MS * 20));
    expect(run.raised('feed.wrongFormat')).toBe(0);
    expect(run.raised('feed.packetLoss')).toBe(1);
    await run.pipeline.stop();
  });

  it('within a session', async () => {
    const run = liveRun();
    const packets = lossySession(78n);
    const sendAt = packets.findIndex(({ packet }) => packet.packetId === PacketId.event && packet.details.code === 'SEND');
    // the session's frames, without its SEND: packet loss raises
    const last = run.play(packets.slice(0, sendAt), 1000);
    expect(run.raised('feed.packetLoss')).toBe(1);
    // a wrong-format datagram within the session raises
    run.push(wrongFormat(), last + 10);
    expect(run.raised('feed.wrongFormat')).toBe(1);
    expect(run.status()).toMatchObject({ betweenSessions: false });
    await run.pipeline.stop();
  });
});
