// The typed, reference-counted topic store (spec 6.2). One per window; the shell reads it, widgets only get props.
import {
  canonicalJson,
  CONTRACT_VERSION,
  type ActionOutcome,
  type ClientMessage,
  type FeedInfo,
  type Fold,
  type ServerMessage,
  type SessionInfo,
  type TopicName,
  type TopicParams,
  type TopicValue,
} from '@pitwall/contracts';
import type { FeedId, SessionTime } from '@pitwall/domain';
import type { Connection, ConnectionState } from './connection.ts';

/** How an append topic's entries become a value. `add` must return a new value, never mutate `acc`. */
export type { Fold } from '@pitwall/contracts';
/** What a panel reads: `waiting` until the first snapshot, then `ok`, `noData` or `errored`. */
export type EntryState<V> = { status: 'waiting' | 'ok' | 'noData' | 'errored'; value: V | undefined };

/** Which topic to read: name, params and feed. */
export type TopicKey<T extends TopicName> = { topic: T; params: TopicParams<T>; feedId?: FeedId };

type UiActionMessage = Extract<ClientMessage, { type: 'uiAction' }>;

/** The outcome of a uiAction the bridge never answered: the link was not open, or closed before the answer (C73). */
const LINK_LOST: ActionOutcome = { ok: false, reason: 'notSupported', message: 'The link to the bridge closed before it answered.' };

type Entry = {
  key: TopicKey<TopicName>;
  holders: number;
  /** The wire id of the live subscription; undefined while the connection is not open. */
  id: string | undefined;
  fold: Fold<unknown, unknown> | undefined;
  /** The fold's accumulator, or the plain entries of an append topic without a fold. */
  acc: unknown;
  state: EntryState<unknown>;
};

/** The window's topics: shared, reference-counted subscriptions whose values are runes. */
export class TopicStore {
  #connection = $state<ConnectionState>('connecting');
  #contractMismatch = $state(false);
  #feeds = $state.raw<FeedInfo[]>([]);
  /** The state of the link to the bridge. */
  get connection(): ConnectionState {
    return this.#connection;
  }
  /** The feeds the bridge announced in its last `hello`; empty before the first. */
  get feeds(): FeedInfo[] {
    return this.#feeds;
  }
  /** True once `hello` announced another contract version; the shell then reloads. */
  get contractMismatch(): boolean {
    return this.#contractMismatch;
  }

  private readonly link: Connection;
  private readonly entries = new Map<string, Entry>();
  private readonly byId = new Map<string, Entry>();
  private readonly clock = $state<Record<string, SessionTime>>({});
  private readonly offs: Array<() => void>;
  private readonly foldIds = new WeakMap<object, number>();
  /** The uiActions awaiting their `actionResult`, by message id. */
  private readonly pending = new Map<string, (outcome: ActionOutcome) => void>();
  private nextId = 1;
  private nextFoldId = 1;

  constructor(link: Connection) {
    this.link = link;
    this.#connection = link.state;
    this.offs = [
      link.onMessage((m) => this.handle(m)),
      link.onState((s) => {
        this.#connection = s;
        if (s === 'open') this.resubscribeAll();
        else this.failPending();
      }),
    ];
  }

  /** Stops processing messages and resubscribing, and closes the connection. */
  dispose(): void {
    for (const off of this.offs) off();
    this.failPending();
    this.link.close();
  }

  /** Takes a share of the subscription for `key`; the last `release` unsubscribes. Equal keys share one entry. */
  acquire<T extends TopicName, V = TopicValue<T>>(
    key: TopicKey<T>,
    fold?: Fold<TopicValue<T>, V>,
  ): { state: EntryState<V>; release(): void } {
    const text = canonicalJson([key.feedId ?? null, key.topic, key.params, this.foldId(fold)]);
    let entry = this.entries.get(text);
    if (entry === undefined) {
      let status = $state<EntryState<unknown>['status']>('waiting');
      let value = $state.raw<unknown>(undefined);
      // Values are only ever replaced, so they stay unproxied.
      const state: EntryState<unknown> = {
        get status() {
          return status;
        },
        set status(next) {
          status = next;
        },
        get value() {
          return value;
        },
        set value(next) {
          value = next;
        },
      };
      entry = {
        key: key as TopicKey<TopicName>,
        holders: 0,
        id: undefined,
        fold: fold as Fold<unknown, unknown> | undefined,
        acc: undefined,
        state,
      };
      this.entries.set(text, entry);
      if (this.#connection === 'open') this.subscribe(entry);
    }
    entry.holders += 1;
    const held = entry;
    let released = false;
    return {
      state: held.state as EntryState<V>,
      release: () => {
        if (released) return;
        released = true;
        held.holders -= 1;
        if (held.holders > 0) return;
        this.entries.delete(text);
        if (held.id === undefined) return;
        this.byId.delete(held.id);
        this.link.send({ type: 'unsubscribe', id: held.id });
      },
    };
  }

  /** The newest session time seen for `feedId` in its `session.info`, if that topic is acquired. */
  now(feedId: FeedId): SessionTime | undefined {
    return this.clock[feedId];
  }

  /**
   * Sends a client message (`uiAction`, `replayControl`). A uiAction returns its outcome: the bridge's `actionResult`
   * of the same id (C73), or a failure when the link is not open or closes before the answer.
   */
  send(message: UiActionMessage): Promise<ActionOutcome>;
  send(message: ClientMessage): void;
  send(message: ClientMessage): Promise<ActionOutcome> | void {
    if (message.type !== 'uiAction') {
      this.link.send(message);
      return;
    }
    // The connection drops what it cannot send, so no answer would come.
    if (this.link.state !== 'open') return Promise.resolve(LINK_LOST);
    const outcome = new Promise<ActionOutcome>((resolve) => this.pending.set(message.id, resolve));
    this.link.send(message);
    return outcome;
  }

  /** Fails every unanswered uiAction: its answer can no longer arrive. */
  private failPending(): void {
    const resolves = [...this.pending.values()];
    this.pending.clear();
    for (const resolve of resolves) resolve(LINK_LOST);
  }

  /** Folds are part of the key: a different fold, or none, is its own entry. */
  private foldId(fold: object | undefined): number {
    if (fold === undefined) return 0;
    let id = this.foldIds.get(fold);
    if (id === undefined) {
      id = this.nextFoldId++;
      this.foldIds.set(fold, id);
    }
    return id;
  }

  private subscribe(entry: Entry): void {
    if (entry.id !== undefined) this.byId.delete(entry.id);
    const id = `s${this.nextId++}`;
    entry.id = id;
    this.byId.set(id, entry);
    const { topic, params, feedId } = entry.key;
    this.link.send(feedId === undefined ? { type: 'subscribe', id, topic, params } : { type: 'subscribe', id, topic, params, feedId });
  }

  private resubscribeAll(): void {
    for (const entry of this.entries.values()) this.subscribe(entry);
  }

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'hello':
        this.#feeds = message.feeds;
        if (message.contractVersion !== CONTRACT_VERSION) this.#contractMismatch = true;
        return;
      case 'snapshot': {
        const entry = this.byId.get(message.id);
        if (entry === undefined) return;
        if (message.entries !== undefined) {
          entry.acc = entry.fold === undefined ? [...message.entries] : entry.fold.add(entry.fold.init(), message.entries);
          this.publish(entry, entry.acc);
        } else {
          this.publish(entry, message.value);
        }
        return;
      }
      case 'update': {
        const entry = this.byId.get(message.id);
        if (entry !== undefined) this.publish(entry, message.value);
        return;
      }
      case 'append': {
        const entry = this.byId.get(message.id);
        if (entry === undefined) return;
        entry.acc =
          entry.fold === undefined
            ? [...((entry.acc as unknown[] | undefined) ?? []), ...message.entries]
            : entry.fold.add(entry.acc ?? entry.fold.init(), message.entries);
        this.publish(entry, entry.acc);
        return;
      }
      case 'topicStatus': {
        const entry = this.byId.get(message.id);
        if (entry !== undefined) entry.state.status = message.status;
        return;
      }
      case 'actionResult': {
        const resolve = this.pending.get(message.id);
        if (resolve === undefined) return;
        this.pending.delete(message.id);
        const { type: _type, id: _id, ...outcome } = message;
        resolve(outcome);
        return;
      }
      case 'error': {
        const entry = message.id === undefined ? undefined : this.byId.get(message.id);
        if (entry !== undefined) entry.state.status = 'errored';
        return;
      }
      default:
        return;
    }
  }

  private publish(entry: Entry, value: unknown): void {
    entry.state.value = value;
    entry.state.status = 'ok';
    if (entry.key.topic === 'session.info' && entry.key.feedId !== undefined) {
      const updatedAt = (value as Partial<SessionInfo> | undefined)?.session?.updatedAt;
      if (updatedAt !== undefined) this.clock[entry.key.feedId] = updatedAt;
    }
  }
}
