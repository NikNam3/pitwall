// What the top bar's segments read: the topics of one feed plus the global alert and settings topics.
import type { AlertsState, CarOverview, FeedStatus, ReplayControl, ReplayStatus, SessionInfo, UiAction, UiSettings } from '@pitwall/contracts';
import type { MachineSpans } from '@pitwall/contracts';
import type { CarId, FeedId, Insight, Known, Moment, NeutralisedDetail, NeutralisedStage, OpenSpan, RaceMoment, TalkWindow } from '@pitwall/domain';
import { untrack } from 'svelte';
import type { EntryState, TopicStore } from '../../connection/topic-store.svelte.ts';
import { openSpanOf } from '../../kit/situation.ts';
import * as text from '../../kit/text.ts';
import type { Role } from '../../theme/index.ts';
import { activeInsights, MAX_SHOWN_ALERTS, tierOneAlerts } from './alerts.ts';
import { phaseOf, type PhaseMachine } from './phase-presentation.ts';

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
  readonly #weekend: EntryState<MachineSpans>;
  readonly #clock: EntryState<MachineSpans>;
  readonly #phases: Record<'race' | 'qualifying' | 'practice', EntryState<MachineSpans>>;
  /** The open workbook's name, set by the top bar; undefined until a workbook is known. */
  workbookName = $state<string | undefined>();
  /** Opens the workbook picker, set by the top bar. */
  pickWorkbook: () => void = () => {};
  /** The name of the calibration set the run uses (`defaults` without one), set by the top bar; undefined while unknown. */
  calibrationName = $state<string | undefined>();
  /** Opens the calibration prompt, set by the top bar. */
  pickCalibration: () => void = () => {};
  /** The talk window of the current player car; replaced when the player car changes. */
  #talk = $state.raw<EntryState<TalkWindow> | undefined>();
  readonly #stopTalk: () => void;
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
    this.#weekend = take(store.acquire({ topic: 'situation.weekendPhase', params: {}, feedId }));
    this.#clock = take(store.acquire({ topic: 'situation.clock', params: {}, feedId }));
    this.#phases = {
      race: take(store.acquire({ topic: 'situation.sessionPhaseRace', params: {}, feedId })),
      qualifying: take(store.acquire({ topic: 'situation.sessionPhaseQualifying', params: {}, feedId })),
      practice: take(store.acquire({ topic: 'situation.sessionPhasePractice', params: {}, feedId })),
    };
    // The feed's kind is fixed by its hello; a replay feed has a transport.
    this.#isReplay = store.feeds.find((f) => f.feedId === feedId)?.kind === 'replay';
    // The talk window takes the player car as a param: acquired once session.info names it, again when it changes.
    this.#stopTalk = $effect.root(() => {
      const playerCar = $derived<CarId | undefined>(okValue(this.#session)?.playerCar);
      $effect(() => {
        const player = playerCar;
        if (player === undefined) return;
        const held = untrack(() => store.acquire({ topic: 'talkWindow.car', params: { carId: player }, feedId }));
        this.#talk = held.state;
        return () => {
          held.release();
          this.#talk = undefined;
        };
      });
    });
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
  /** The weekend phase's open span (`situation.weekendPhase`); undefined while the phase is pending or not published. */
  get weekendPhase(): OpenSpan | undefined {
    return openSpanOf(okValue(this.#weekend));
  }
  /** The race moment; undefined while it is unknown or not published. */
  get moment(): Moment | undefined {
    const current = okValue(this.#moment);
    return current?.known ? current.value.moment : undefined;
  }
  /**
   * The session phase to show: PAUSED while the clock is paused, else the open span of the session-phase machine of the
   * weekend phase through its presentation table. Undefined while hidden, pending or `none`.
   */
  get phase(): { label: string; role: Role | undefined; stage: NeutralisedStage | undefined } | undefined {
    const weekend = this.weekendPhase?.kind;
    if (weekend !== 'race' && weekend !== 'qualifying' && weekend !== 'practice') return undefined;
    if (openSpanOf(okValue(this.#clock))?.kind === 'paused') return { label: text.topBar.phase.paused, role: undefined, stage: undefined };
    const machine: PhaseMachine = weekend === 'race' ? 'session-phase-race' : weekend === 'qualifying' ? 'session-phase-qualifying' : 'session-phase-practice';
    const span = openSpanOf(okValue(this.#phases[weekend]));
    const shown = span === undefined ? undefined : phaseOf(machine, span);
    if (span === undefined || shown === undefined) return undefined;
    const stages = shown.label === 'sc' || shown.label === 'vsc' ? (span.detail as NeutralisedDetail | undefined)?.stages : undefined;
    return { label: text.topBar.phase[shown.label], role: shown.role, stage: stages?.at(-1)?.stage };
  }
  /** The talk window of the player car; undefined while unknown, not applicable or without a player car. */
  get talk(): 'clear' | 'busy' | undefined {
    const talk = okValue(this.#talk)?.talk;
    return talk?.known ? talk.value : undefined;
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
    this.#stopTalk();
    for (const release of this.#releases) release();
  }
}
