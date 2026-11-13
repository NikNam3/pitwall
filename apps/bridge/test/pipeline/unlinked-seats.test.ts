// Our feeds' human seats without a link (SP4.3b2 Task 10, row 6; C17, C54, C62c, spec 10 shell U7): `drivers.links`
// carries `unlinkedSeats`, per running feed its player car and its teammate while their `car-driver` span is `human` and
// their seat (team and race number from Participants) has no link. Seam: each `FeedPipeline` tells its `profiles`
// option (the profile store) its feed's human seats as they change, `feedSeats(feedId, seats)`, and none once the feed
// stops; the store keeps the ones without a link and publishes `drivers.links` when they change or a link changes. Two
// builder feeds, a real profile store on a temporary data dir with no stored session (C84).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TopicName } from '@pitwall/contracts';
import { carId, feedId, type DriversLinksValue, type FeedId, type LiveSeat } from '@pitwall/domain';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { ProfileStore } from '../../src/drivers/store.ts';
import { FEATURES } from '../../src/features/index.generated.ts';
import type { ValueFor } from '../../src/hub/topic-hub.ts';
import { TopicHub } from '../../src/hub/topic-hub.ts';
import { createLogger } from '../../src/log.ts';
import { FeedPipeline } from '../../src/pipeline/feed-pipeline.ts';
import { ManualSource } from '../helpers/manual-source.ts';

type Timed = ReturnType<ScenarioBuilder['packets']>;

const A = feedId('udp-20777');
const B = feedId('udp-20778');
const log = createLogger({ level: 'silent', destination: new Writable({ write(_c, _e, cb) { cb(); } }) });

/**
 * A builder session of four cars, two teams (3: cars 0 and 1; 4: cars 2 and 3), race numbers 1 to 4, player car
 * `player`; the builder's player is human and every other car the AI unless `humans` names it.
 */
const builder = (player: number, humans: readonly number[] = []): ScenarioBuilder =>
  new ScenarioBuilder({ sessionUid: 7n, cars: 4, player }).participants({
    participants: [3, 3, 4, 4].map((teamId, i) => ({ teamId, ...(humans.includes(i) && { aiControlled: 0 }) })),
  });

const stops: Array<() => Promise<void>> = [];
const opened: ProfileStore[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const store of opened.splice(0)) store.close();
});

/** A real profile store on a temporary data dir, publishing to a fake hub that keeps every value of `drivers.links`. */
function profileStore() {
  const links: DriversLinksValue[] = [];
  const hub = {
    publishGlobal: (topic: TopicName, valueFor: ValueFor) => {
      if (topic === 'drivers.links') links.push(valueFor({}) as DriversLinksValue);
    },
  };
  const store = ProfileStore.open(mkdtempSync(join(tmpdir(), 'unlinked-seats-')), {
    features: [], repo: { driverSessions: () => [] }, config: {}, hub, log, rebuild: async () => {},
  });
  opened.push(store);
  const seats = (): string[] =>
    (links.at(-1)?.unlinkedSeats ?? []).map((s: LiveSeat) => `${s.feedId}/${s.carId}/${s.team}/${s.raceNumber}`).toSorted();
  return { store, links, seats };
}

/** Starts a pipeline of feed `id` on a manual source with the store as its `profiles`; returns a `push` and its stop. */
function feed(id: FeedId, store: ProfileStore) {
  const source = new ManualSource(id);
  const pipeline = new FeedPipeline({ feedId: id, source, hub: new TopicHub({ now: () => 0 }), features: FEATURES, log, profiles: store });
  pipeline.start();
  const stop = async () => {
    await source.stop();
    await pipeline.done;
  };
  stops.push(stop);
  const push = (packets: Timed): void => {
    for (const { packet, receivedAtMs } of packets) source.push(packetBytes(packet), receivedAtMs);
  };
  return { push, stop };
}

describe('drivers.links.unlinkedSeats (SP4.3b2 Task 10)', () => {
  it('unlinkedSeats lists a human player car without a link; an AI car or a linked seat is absent; a new link removes it', async () => {
    const p = profileStore();
    // Seat team 4, race number 4 is linked before any session.
    expect(p.store.apply({ kind: 'drivers.add', person: 'dee', displayName: 'Dee' })).toEqual({ ok: true });
    expect(p.store.linkSeat(4, 4, 'dee')).toEqual({ ok: true });
    expect(p.seats()).toEqual([]);

    // Feed A: player car 0 (team 3, #1) human, its teammate car 1 the AI. Feed B: player car 2 (team 4, #3) and its
    // teammate car 3 (team 4, #4) both human; car 3's seat is linked.
    const a = feed(A, p.store);
    const b = feed(B, p.store);
    a.push(builder(0).frames(30, () => {}).packets());
    b.push(builder(2, [3]).frames(30, () => {}).packets());
    await vi.waitFor(() => expect(p.seats()).toEqual([`${A}/0/3/1`, `${B}/2/4/3`]));
    // Published when the seats change, not on every frame.
    expect(p.links.length).toBeLessThan(10);
    const seat = p.links.at(-1)?.unlinkedSeats.find((s) => s.feedId === A);
    expect(seat).toEqual({ feedId: A, carId: carId(0), team: 3, raceNumber: 1 });

    // A new link of feed A's seat removes it at once.
    expect(p.store.apply({ kind: 'drivers.add', person: 'asym', displayName: 'Asymetrisch' })).toEqual({ ok: true });
    expect(p.store.linkSeat(3, 1, 'asym')).toEqual({ ok: true });
    expect(p.seats()).toEqual([`${B}/2/4/3`]);
    // Unlinked again: back.
    expect(p.store.linkSeat(3, 1, null)).toEqual({ ok: true });
    expect(p.seats()).toEqual([`${A}/0/3/1`, `${B}/2/4/3`]);

    // A feed that stops runs no more: its seats leave.
    await b.stop();
    await vi.waitFor(() => expect(p.seats()).toEqual([`${A}/0/3/1`]));
  });
});
