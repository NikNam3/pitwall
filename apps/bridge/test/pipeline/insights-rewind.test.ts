// A flashback and the insights topic (C30, C32, C33): the publisher keeps the session's insight changes in memory with
// the frame that produced them; on `rewound` it sends the insights topic again whole, without the changes after the
// rewind's target. A client then holds what a run that never received the undone frames gives it.
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import { toSessionTime, type FeedId, type Insight } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { defineFeature } from '../../src/features/feature.ts';
import insightsFeature from '../../src/features/insights/register.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ArraySource, type PreparedPacket } from '../helpers/array-source.ts';

const F = 'test' as FeedId;
type Timed = ReturnType<ScenarioBuilder['packets']>;
const toPrepared = (packets: Timed): PreparedPacket[] => packets.map(({ packet, receivedAtMs }) => ({ bytes: packetBytes(packet), receivedAtMs }));
const frames = (n: number) => new ScenarioBuilder({ sessionUid: 77n, cars: 2 }).session().participants().frames(n, () => {});

/** Frames 0..59, then the game rewinds to frame 30: `frameIdentifier` goes back while `overallFrameIdentifier` rises. */
const withFlashback = (): PreparedPacket[] => {
  const continuation = frames(80).packets().filter((p) => p.packet.header.frameIdentifier > 30 && p.packet.header.frameIdentifier < 80);
  const rewound = continuation.map(({ packet, receivedAtMs }) => ({
    packet: { ...packet, header: { ...packet.header, overallFrameIdentifier: packet.header.frameIdentifier + 29 } },
    receivedAtMs: receivedAtMs + 29 * 16,
  }));
  return [...toPrepared(frames(60).packets()), ...toPrepared(rewound)];
};
/** The same session without the undone frames: frames 0..79 straight. */
const straight = (): PreparedPacket[] => toPrepared(frames(80).packets());

const insight = (key: string): Insight => ({ key, severity: 'info', category: 'race', feedId: F, kind: key, params: {}, raisedAt: toSessionTime(0) });
/** On every frame: `early` holds from 100 ms on (raised at frame 7, before the target), `late` from 700 ms (frame 44, after it). */
const probe: QuickCalculator<number> = {
  kind: 'quick', id: 'probe.clock', reads: ['feed'], cadence: 'frame',
  compute: (v) => v.state.sessionTime,
  insights: (t) => [...(t >= 100 ? [insight('early')] : []), ...(t >= 700 ? [insight('late')] : [])],
};
const probeFeature = defineFeature({ name: 'probe-clock', calculators: [probe], topics: [] });

type Entry = { type: 'raised'; insight: Insight } | { type: 'resolved'; key: string; at: number };

/** Runs `packets` with one client subscribed to `insights`; returns the insights messages it received. */
async function insightsMessages(packets: PreparedPacket[]): Promise<ServerMessage[]> {
  const hub = new TopicHub({ now: () => 0 });
  const inbox: ServerMessage[] = [];
  hub.addClient('c', { send: (m) => inbox.push(m), bufferedAmount: () => 0 });
  hub.subscribe({ clientId: 'c', id: 'insights', topic: 'insights', params: {}, feedId: F });
  const pipeline = new FeedPipeline({ feedId: F, source: new ArraySource(F, packets), hub, features: [insightsFeature, probeFeature], log: createLogger({ level: 'silent' }) });
  pipeline.start();
  await pipeline.done;
  return inbox.filter((m) => 'id' in m && m.id === 'insights');
}

/** The entries of an append topic as a client holds them: a snapshot replaces them, an append adds to them. */
const held = (messages: ServerMessage[]): Entry[] =>
  messages.reduce<Entry[]>((entries, m) => {
    if (m.type === 'snapshot' && 'entries' in m) return [...((m.entries ?? []) as Entry[])];
    if (m.type === 'append') return [...entries, ...(m.entries as Entry[])];
    return entries;
  }, []);

const raised = (key: string, at: number): Entry => ({ type: 'raised', insight: { ...insight(key), raisedAt: toSessionTime(at / 1000) } });

describe('FeedPipeline: the insights topic after a flashback', () => {
  it('on `rewound` the insights topic is resent whole, without the changes after the target', async () => {
    const messages = await insightsMessages(withFlashback());
    const lateRaised = messages.findIndex((m) => m.type === 'append' && (m.entries as Entry[]).some((e) => e.type === 'raised' && e.insight.key === 'late'));
    expect(lateRaised).toBeGreaterThanOrEqual(0);
    // the first snapshot after `late` was raised (frame 44) is the resend on the rewind to frame 30: `early` (frame 7) only
    const resend = messages.slice(lateRaised + 1).find((m) => m.type === 'snapshot');
    expect(resend).toEqual({ type: 'snapshot', id: 'insights', entries: [raised('early', 7 * 16)] });
    // the client then holds what a run that never received the undone frames gives it: `late` raised anew at frame 44
    expect(held(messages)).toEqual(held(await insightsMessages(straight())));
    expect(held(messages)).toEqual([raised('early', 7 * 16), raised('late', 44 * 16)]);
  });
});
