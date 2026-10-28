// A `Connection` that answers subscriptions from a moment file and per-cell overrides (spec 9.2); the topic store and
// the panels cannot tell it from the bridge.
import type { ClientMessage, ServerMessage, TopicName, TopicStatus } from '@pitwall/contracts';
import { TOPICS } from '@pitwall/contracts';
import type { Connection, ConnectionState } from '../connection/connection.ts';
import type { MomentValues } from './moment-values.ts';

/**
 * Replaces the value of every subscription to `topic`, whatever its params, even one the moment lacks.
 * An undefined `value` makes the topic `noData`; `status` answers with that status instead of a value.
 * For an append topic the value is the list of entries.
 */
export type GalleryOverride = { topic: TopicName; value?: unknown; status?: TopicStatus };

/** JSON with sorted object keys, so equal params give equal text. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_k, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

/** Open from the start; answers each subscribe with a snapshot or a status on the next microtask and pushes nothing else. */
export class GalleryConnection implements Connection {
  readonly state: ConnectionState = 'open';
  readonly #moment: MomentValues;
  readonly #overrides: readonly GalleryOverride[];
  readonly #listeners = new Set<(m: ServerMessage) => void>();

  constructor(moment: MomentValues, overrides: readonly GalleryOverride[] = []) {
    this.#moment = moment;
    this.#overrides = overrides;
  }

  send(message: ClientMessage): void {
    if (message.type !== 'subscribe') return;
    const answer = this.#answer(message.id, message.topic, message.params);
    queueMicrotask(() => {
      for (const cb of [...this.#listeners]) cb(answer);
    });
  }

  onMessage(cb: (m: ServerMessage) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  onState(): () => void {
    return () => {};
  }

  close(): void {}

  #answer(id: string, topic: TopicName, params: object): ServerMessage {
    const override = this.#overrides.find((o) => o.topic === topic);
    if (override?.status !== undefined) return { type: 'topicStatus', id, status: override.status };
    if (override !== undefined) return this.#snapshot(id, override.value, TOPICS[topic].mode === 'append');
    const wanted = canonical(params);
    const entry = this.#moment.find((e) => e.topic === topic && canonical(e.params) === wanted);
    if (entry === undefined) return { type: 'topicStatus', id, status: 'noData' };
    return entry.entries !== undefined ? { type: 'snapshot', id, entries: entry.entries } : this.#snapshot(id, entry.value, false);
  }

  #snapshot(id: string, value: unknown, append: boolean): ServerMessage {
    if (value === undefined) return { type: 'topicStatus', id, status: 'noData' };
    return append ? { type: 'snapshot', id, entries: value as unknown[] } : { type: 'snapshot', id, value };
  }
}
