// The team's feeds (SP4.3b Task 2b; C1a, spec 8.5): the feeds of one session uid whose player cars have the same team
// (Participants). Seam: `new TeamFeeds()` (`src/pipeline/team-feeds.ts`), handed to every `FeedPipeline` as its option
// `teams`; each pipeline tells it its session uid and its player car's team as they change. `teamOf(feedId)` lists the
// feeds of `feedId`'s team, `feedId` included; a feed whose team is not known is alone.
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@pitwall/contracts';
import { feedId, type FeedId } from '@pitwall/domain';
import { PacketId } from '@pitwall/protocol';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { TeamFeeds } from '../../src/pipeline/team-feeds.ts';
import { ManualSource } from '../helpers/manual-source.ts';

type Timed = ReturnType<ScenarioBuilder['packets']>;

/** A builder session of `cars` cars, `uid`, player car `player`; `teams` gives the slots' teams (index = car). */
const builder = (uid: bigint, player: number, teams: readonly number[]): ScenarioBuilder =>
  new ScenarioBuilder({ sessionUid: uid, cars: teams.length, player }).participants({ participants: teams.map((teamId) => ({ teamId })) });

const stops: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

/** One hub, one `TeamFeeds`; `feed(id)` starts a pipeline on a manual source and returns a `push` for its packets. */
function bridge() {
  const hub = new TopicHub({ now: () => 0 });
  const sent: Array<ServerMessage & { feed: FeedId }> = [];
  const teams = new TeamFeeds();
  const log = createLogger({ level: 'silent', destination: new Writable({ write(_c, _e, cb) { cb(); } }) });
  const feed = (id: FeedId) => {
    hub.addClient(`c-${id}`, { send: (m) => sent.push({ ...m, feed: id }), bufferedAmount: () => 0 });
    hub.subscribe({ clientId: `c-${id}`, id: 'info', topic: 'session.info', params: {}, feedId: id });
    const source = new ManualSource(id);
    // The `teams` option is the seam this task adds to `FeedPipeline`.
    const withTeams = { teams };
    const pipeline = new FeedPipeline({ feedId: id, source, hub, features: FEATURES, log, ...withTeams });
    pipeline.start();
    stops.push(async () => {
      await source.stop();
      await pipeline.done;
    });
    return (packets: Timed): void => {
      for (const { packet, receivedAtMs } of packets) source.push(packetBytes(packet), receivedAtMs);
    };
  };
  /** True once feed `id` has published its session's `session.info`. */
  const started = (id: FeedId): boolean => sent.some((m) => m.feed === id && m.type === 'update' && 'value' in m);
  const teamOf = (id: FeedId): FeedId[] => [...teams.teamOf(id)].sort();
  return { feed, started, teamOf };
}

const A = feedId('udp-20777');
const B = feedId('udp-20778');
const C = feedId('udp-20779');

describe('TeamFeeds: the team\'s feeds (C1a)', () => {
  it('two feeds of one session uid whose player cars have the same team are one team', async () => {
    const b = bridge();
    b.feed(A)(builder(7n, 0, [3, 3, 4, 4]).frames(5, () => {}).packets());
    b.feed(B)(builder(7n, 1, [3, 3, 4, 4]).frames(5, () => {}).packets());
    await vi.waitFor(() => expect(b.started(A) && b.started(B)).toBe(true));
    await vi.waitFor(() => expect(b.teamOf(A)).toEqual([A, B]));
    expect(b.teamOf(B)).toEqual([A, B]);
  });

  it('a feed of another team, or of another session, is not in the team', async () => {
    const b = bridge();
    // A: session 7, team 3. B: session 7, team 4. C: session 8, team 3.
    b.feed(A)(builder(7n, 0, [3, 4, 3, 4]).frames(5, () => {}).packets());
    b.feed(B)(builder(7n, 1, [3, 4, 3, 4]).frames(5, () => {}).packets());
    b.feed(C)(builder(8n, 2, [3, 4, 3, 4]).frames(5, () => {}).packets());
    await vi.waitFor(() => expect(b.started(A) && b.started(B) && b.started(C)).toBe(true));
    expect(b.teamOf(A)).toEqual([A]);
    expect(b.teamOf(B)).toEqual([B]);
    expect(b.teamOf(C)).toEqual([C]);
  });

  it('a feed before its Participants is alone; it joins once its team is known', async () => {
    const b = bridge();
    b.feed(A)(builder(7n, 0, [3, 3, 4, 4]).frames(5, () => {}).packets());
    // B's session starts without Participants (the builder's leading one is dropped); they arrive with frame 5.
    const later = builder(7n, 1, [3, 3, 4, 4]).frames(5, () => {}).participants({ participants: [3, 3, 4, 4].map((teamId) => ({ teamId })) })
      .frames(5, () => {}).packets();
    const firstParticipants = later.findIndex(({ packet }) => packet.packetId === PacketId.participants);
    const secondParticipants = later.findIndex(({ packet }, i) => i > firstParticipants && packet.packetId === PacketId.participants);
    const pushB = b.feed(B);
    pushB(later.slice(0, secondParticipants).filter((_, i) => i !== firstParticipants));
    // A pipeline processes each pushed datagram as it arrives, so B's first frames are in; its session publishes nothing
    // before Participants.
    await vi.waitFor(() => expect(b.started(A)).toBe(true));
    expect(b.teamOf(B)).toEqual([B]);
    expect(b.teamOf(A)).toEqual([A]);

    pushB(later.slice(secondParticipants));
    await vi.waitFor(() => expect(b.teamOf(B)).toEqual([A, B]));
    expect(b.teamOf(A)).toEqual([A, B]);
  });
});
