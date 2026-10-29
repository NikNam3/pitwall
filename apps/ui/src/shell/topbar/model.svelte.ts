// What the top bar's segments read: the topics of one feed plus the global alert and settings topics.
import type { AlertsState, CarOverview, FeedStatus, ReplayControl, ReplayStatus, SessionInfo, UiAction, UiSettings } from '@pitwall/contracts';
import type { FeedId, Insight, Known, Moment, RaceMoment } from '@pitwall/domain';
import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
import { activeInsights, MAX_SHOWN_ALERTS, tierOneAlerts } from './alerts.ts';

const okValue = <T>(state: EntryState<T> | undefined): T | undefined => (state?.status === 'ok' ? state.value : undefined);

/** Acquires its topics when made; `release` gives them back. */
export class TopBarModel {
  readonly send: (action: UiAction) => void;
  readonly sendReplay: (control: ReplayControl) => void;
  readonly #session: EntryState<SessionInfo>;
  readonly #feed: EntryState<FeedStatus>;
  readonly #cars: EntryState<CarOverview[]>;
  readonly #insights: EntryState<Map<string, Insight>>;
  readonly #alerts: EntryState<AlertsState>;
  readonly #settings: EntryState<UiSettings>;
  readonly #moment: EntryState<Known<RaceMoment>>;
  readonly #releases: Array<() => void> = [];
  readonly #isReplay: boolean;
  readonly #replay: EntryState<ReplayStatus> | undefined;

  constructor(store: TopicStore, feedId: FeedId, send: (action: UiAction) => void, sendReplay: (control: ReplayControl) => void) {
    this.send = send;
    this.sendReplay = sendReplay;
    const take = <S>(held: { state: EntryState<S>; release(): void }): EntryState<S> => {
      this.#releases.push(held.release);
      return held.state;
    };
    this.#session = take(store.acquire({ topic: 'session.info', params: {}, feedId }));
    this.#feed = take(store.acquire({ topic: 'feed.status', params: {}, feedId }));
    // The player's lap: the same source for a live and a replay feed.
    this.#cars = take(store.acquire({ topic: 'cars.overview', params: {}, feedId }));
    this.#insights = take(store.acquire({ topic: 'insights', params: {}, feedId }, activeInsights));
    this.#alerts = take(store.acquire({ topic: 'ui.alerts', params: {} }));
    this.#settings = take(store.acquire({ topic: 'ui.settings', params: {} }));
    // Optional: no data until the race-moment analysis publishes, and notApplicable outside the race.
    this.#moment = take(store.acquire({ topic: 'raceMoment.current', params: {}, feedId }));
    // The feed's kind is fixed by its hello; a replay feed has a transport.
    this.#isReplay = store.feeds.find((f) => f.feedId === feedId)?.kind === 'replay';
    this.#replay = this.#isReplay ? take(store.acquire({ topic: 'replay.status', params: {}, feedId })) : undefined;
  }

  get session(): SessionInfo | undefined {
    return okValue(this.#session);
  }
  /** The player car's current lap; undefined until the overview has the player car. */
  get playerLap(): number | undefined {
    const player = this.session?.playerCar;
    return player === undefined ? undefined : okValue(this.#cars)?.find((car) => car.id === player)?.timing?.lap;
  }
  /** The race moment; undefined while it is unknown or not published. */
  get moment(): Moment | undefined {
    const current = okValue(this.#moment);
    return current?.known ? current.value.moment : undefined;
  }
  get feed(): FeedStatus | undefined {
    return okValue(this.#feed);
  }
  get settings(): UiSettings | undefined {
    return okValue(this.#settings);
  }
  /** True for a replay feed: the transport shows. */
  get isReplay(): boolean {
    return this.#isReplay;
  }
  get replay(): ReplayStatus | undefined {
    return okValue(this.#replay);
  }
  /** The alerts muted now. */
  get muted(): AlertsState['muted'] {
    return okValue(this.#alerts)?.muted ?? [];
  }
  /** All tier-1 alerts, oldest first; none until the acknowledged and muted sets are known. */
  get alerts(): Insight[] {
    const alerts = okValue(this.#alerts);
    const active = okValue(this.#insights);
    return alerts === undefined || active === undefined ? [] : tierOneAlerts(active, alerts);
  }
  /** The alerts the bar shows. */
  get shown(): Insight[] {
    return this.alerts.slice(0, MAX_SHOWN_ALERTS);
  }
  /** How many alerts are behind `+N`. */
  get hidden(): number {
    return Math.max(0, this.alerts.length - MAX_SHOWN_ALERTS);
  }

  release(): void {
    for (const release of this.#releases) release();
  }
}
