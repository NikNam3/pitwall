// Fans topic values out to subscribed clients (spec 8). Pure bookkeeping: no timers, no sockets, no clock of its own.
// The owner calls `tick()` periodically to flush throttled and backpressured subscriptions.
import type { FeedId } from '@pitwall/domain';
import { TOPICS } from '@pitwall/contracts';
import type { ServerMessage, TopicName, TopicStatus } from '@pitwall/contracts';
import { intervalMs } from './throttle.ts';

export type Subscription = {
  clientId: string;
  /** Chosen by the client; unique per client. */
  id: string;
  topic: TopicName;
  /** Passed through untouched to the topic's `valueFor`; the features validate it. */
  params: object;
  feedId: FeedId;
};

export interface ClientSink {
  send(message: ServerMessage): void;
  /** Bytes queued for this client but not yet written to its socket. */
  bufferedAmount(): number;
}

export type TopicHubOptions = {
  now: () => number;
  /** A client with more than this many bytes queued only gets the newest state, or one fresh snapshot per append topic. */
  backpressureBytes?: number;
};

/** Derives one subscription's value from the latest state; `undefined` means "no data for these params". */
export type ValueFor = (params: object) => unknown;

const DEFAULT_BACKPRESSURE_BYTES = 1_000_000;

/** What the hub knows about one topic of one feed. */
type Channel = { valueFor?: ValueFor; log: unknown[]; status: TopicStatus };

type Entry = {
  subscription: Subscription;
  sink: ClientSink;
  /** When the last message carrying a value (snapshot, update) was sent; the throttle counts from here. */
  lastSentAt?: number;
  /** A newer state exists than the one sent; waits for the throttle interval or for backpressure to clear. */
  pending: boolean;
  /** A fresh snapshot is owed, because the client was backpressured when the log changed. */
  needsSnapshot: boolean;
  lastStatus?: TopicStatus;
};

export class TopicHub {
  private readonly now: () => number;
  private readonly backpressureBytes: number;
  private readonly clients = new Map<string, { sink: ClientSink; entries: Map<string, Entry> }>();
  private readonly channels = new Map<FeedId, Map<TopicName, Channel>>();

  constructor(options: TopicHubOptions) {
    this.now = options.now;
    this.backpressureBytes = options.backpressureBytes ?? DEFAULT_BACKPRESSURE_BYTES;
  }

  addClient(clientId: string, sink: ClientSink): void {
    this.clients.set(clientId, { sink, entries: new Map() });
  }

  removeClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  /** Replaces a subscription with the same `(clientId, id)`. Subscriptions of unknown clients are ignored. */
  subscribe(subscription: Subscription): void {
    const client = this.clients.get(subscription.clientId);
    if (client === undefined) return;
    const entry: Entry = { subscription, sink: client.sink, pending: false, needsSnapshot: false };
    client.entries.delete(subscription.id);
    client.entries.set(subscription.id, entry);
    this.sendSnapshot(entry);
  }

  unsubscribe(clientId: string, id: string): void {
    this.clients.get(clientId)?.entries.delete(id);
  }

  publishState(feedId: FeedId, topic: TopicName, valueFor: ValueFor): void {
    const channel = this.channel(feedId, topic);
    channel.valueFor = valueFor;
    channel.status = 'ok';
    for (const entry of this.entriesOf(feedId, topic)) {
      if (!entry.needsSnapshot) this.flushState(entry);
    }
  }

  publishAppend(feedId: FeedId, topic: TopicName, entries: unknown[]): void {
    if (entries.length === 0) return;
    const channel = this.channel(feedId, topic);
    for (const item of entries) channel.log.push(item);
    channel.status = 'ok';
    for (const entry of this.entriesOf(feedId, topic)) {
      if (entry.needsSnapshot || this.isBackpressured(entry)) {
        // Never drop entries for a slow client: it gets the whole log as one snapshot once it catches up.
        entry.needsSnapshot = true;
      } else {
        this.sendValue(entry, { type: 'append', id: entry.subscription.id, entries });
      }
    }
  }

  setStatus(feedId: FeedId, topic: TopicName, status: TopicStatus): void {
    this.channel(feedId, topic).status = status;
    for (const entry of this.entriesOf(feedId, topic)) {
      if (status === 'errored') entry.pending = false;
      this.syncStatus(entry);
    }
  }

  /** A new session on this feed: forget all values, logs and statuses; every subscriber starts over. */
  resetFeed(feedId: FeedId): void {
    this.channels.delete(feedId);
    for (const entry of this.entriesOfFeed(feedId)) {
      entry.pending = false;
      this.resnapshot(entry);
    }
  }

  /** Replaces an append log (e.g. after a flashback) and sends its subscribers a fresh snapshot. */
  resetAppend(feedId: FeedId, topic: TopicName, entries: unknown[]): void {
    this.channel(feedId, topic).log = [...entries];
    for (const entry of this.entriesOf(feedId, topic)) this.resnapshot(entry);
  }

  /** Flushes whatever the throttle or backpressure held back and is now allowed to go out. */
  tick(): void {
    for (const entry of this.allEntries()) {
      if (entry.needsSnapshot) {
        if (!this.isBackpressured(entry)) this.sendSnapshot(entry);
      } else if (entry.pending) {
        this.flushState(entry);
      }
    }
  }

  private channel(feedId: FeedId, topic: TopicName): Channel {
    let topics = this.channels.get(feedId);
    if (topics === undefined) this.channels.set(feedId, (topics = new Map()));
    let channel = topics.get(topic);
    if (channel === undefined) topics.set(topic, (channel = { log: [], status: 'ok' }));
    return channel;
  }

  private *allEntries(): Generator<Entry> {
    for (const client of this.clients.values()) yield* client.entries.values();
  }

  private *entriesOfFeed(feedId: FeedId): Generator<Entry> {
    for (const entry of this.allEntries()) if (entry.subscription.feedId === feedId) yield entry;
  }

  private *entriesOf(feedId: FeedId, topic: TopicName): Generator<Entry> {
    for (const entry of this.entriesOfFeed(feedId)) if (entry.subscription.topic === topic) yield entry;
  }

  private isBackpressured(entry: Entry): boolean {
    return entry.sink.bufferedAmount() > this.backpressureBytes;
  }

  private isThrottled(entry: Entry): boolean {
    if (entry.lastSentAt === undefined) return false;
    return this.now() - entry.lastSentAt < intervalMs(TOPICS[entry.subscription.topic].maxHz);
  }

  private valueOf(entry: Entry): unknown {
    const { feedId, topic, params } = entry.subscription;
    return this.channel(feedId, topic).valueFor?.(params);
  }

  /** Sends the newest state if the throttle and the client allow it, otherwise remembers that one is waiting. */
  private flushState(entry: Entry): void {
    if (this.isThrottled(entry) || this.isBackpressured(entry)) {
      entry.pending = true;
      return;
    }
    entry.pending = false;
    const value = this.valueOf(entry);
    if (value === undefined) this.syncStatus(entry);
    else this.sendValue(entry, { type: 'update', id: entry.subscription.id, value });
  }

  /** The entry's current state (state topics) or whole log (append topics), then any non-ok status. */
  private sendSnapshot(entry: Entry): void {
    const { id, feedId, topic } = entry.subscription;
    entry.needsSnapshot = false;
    entry.pending = false;
    if (TOPICS[topic].mode === 'append') {
      this.sendFirstValue(entry, { type: 'snapshot', id, entries: [...this.channel(feedId, topic).log] });
    } else {
      const value = this.valueOf(entry);
      if (value !== undefined) this.sendFirstValue(entry, { type: 'snapshot', id, value });
    }
    this.syncStatus(entry);
  }

  /** Sends a snapshot now, or owes one while the client is backpressured. */
  private resnapshot(entry: Entry): void {
    if (this.isBackpressured(entry)) entry.needsSnapshot = true;
    else this.sendSnapshot(entry);
  }

  /** Sends a message that carries a value and starts a new throttle interval. */
  private sendFirstValue(entry: Entry, message: ServerMessage): void {
    entry.sink.send(message);
    entry.lastSentAt = this.now();
    entry.lastStatus = 'ok';
  }

  /** An update or append; announces `ok` first if the client was last told something else. */
  private sendValue(entry: Entry, message: ServerMessage): void {
    if (entry.lastStatus !== 'ok') this.sendStatus(entry, 'ok');
    this.sendFirstValue(entry, message);
  }

  /** Tells the client the status it should see now, unless it already knows. */
  private syncStatus(entry: Entry): void {
    const { feedId, topic } = entry.subscription;
    const { status } = this.channel(feedId, topic);
    const noValue = TOPICS[topic].mode === 'state' && this.valueOf(entry) === undefined;
    const effective = status === 'ok' && noValue ? 'noData' : status;
    if (entry.lastStatus !== effective) this.sendStatus(entry, effective);
  }

  private sendStatus(entry: Entry, status: TopicStatus): void {
    entry.sink.send({ type: 'topicStatus', id: entry.subscription.id, status });
    entry.lastStatus = status;
  }
}
