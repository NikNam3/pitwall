// A changing set of store acquisitions. New requests are acquired before old ones are released, so a request that
// stays in the set keeps its subscription and its value (no flash of `no data yet` when the link changes).
import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
import type { DataRequest } from './requests.ts';

type Held = { state: EntryState<unknown>; release(): void };

/** Holds the acquisitions of the last `hold` call; `states` maps each request's name to its entry state. */
export class Holdings {
  #store: TopicStore;
  #held = new Map<string, Held>();
  #states = $state.raw<Readonly<Record<string, EntryState<unknown>>>>({});

  constructor(store: TopicStore) {
    this.#store = store;
  }

  /** The entry state of every held request, by request name. */
  get states(): Readonly<Record<string, EntryState<unknown>>> {
    return this.#states;
  }

  /** Holds exactly `requests`: acquires the new ones, then releases those no longer asked for. */
  hold(requests: readonly DataRequest[]): void {
    const next = new Map<string, Held>();
    const states: Record<string, EntryState<unknown>> = {};
    for (const request of requests) {
      const held = next.get(request.id) ?? this.#held.get(request.id) ?? this.#store.acquire(request.key, request.fold);
      next.set(request.id, held);
      states[request.name] = held.state;
    }
    const same = next.size === this.#held.size && [...next.keys()].every((id) => this.#held.has(id));
    for (const [id, held] of this.#held) if (!next.has(id)) held.release();
    this.#held = next;
    // An equal set keeps its states object, so readers are not woken for nothing.
    if (!same) this.#states = states;
  }

  /** Releases everything. */
  release(): void {
    this.hold([]);
  }
}
