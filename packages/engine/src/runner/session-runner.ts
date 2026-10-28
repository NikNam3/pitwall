import { toSessionTime, type Ms, type SessionTime } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import type { Frame } from '../frame/frame.ts';
import { historyLengths, truncateHistory, type HistoryDelta } from '../history/delta.ts';
import type { EngineState } from '../state/engine-state.ts';
import { initialState } from '../step/initial-state.ts';
import { ALL_CHANGE_TAGS, step, type ChangeTag, type LapCorrection } from '../step/step.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { SnapshotStore } from './snapshots.ts';

/** Where a flashback took the session: the game's target frame, its session time and the player's lap there. */
export type FlashbackInfo = { targetFrameId: number; targetSessionTime: SessionTime; rewoundMs: Ms; targetLap: number };

/** What applying one frame did. On a flashback `changed` holds every tag and `delta.truncated` is true. */
export type StepResult = {
  state: DeepReadonly<EngineState>;
  changed: Set<ChangeTag>;
  corrections: LapCorrection[];
  delta: HistoryDelta;
  flashback?: FlashbackInfo;
};

export type SessionRunnerOptions = {
  /** Session time between two snapshots. */
  snapshotEveryMs?: number;
  /** Session time of applied frames kept for a replay, so a flashback inside it restores the exact target state. */
  replayWindowMs?: number;
};

/** The frame a flashback goes back to; without an `FLBK` event its session time is only known after the replay. */
type Target = { frameId: number; sessionTime?: SessionTime };

type FlashbackDetails = Extract<EventDetails, { code: 'FLBK' }>;
const isFlashback = (details: EventDetails): details is FlashbackDetails => details.code === 'FLBK';

/**
 * Runs one session's frames through `step` and handles flashbacks (spec 5.4): it takes a snapshot every
 * `snapshotEveryMs` of session time and keeps the frames of the last `replayWindowMs`. A flashback restores the
 * newest snapshot at or before the target, cuts the history back, replays the kept frames up to the target and
 * then applies the game's new frame, so the discarded frames leave no trace.
 */
export class SessionRunner {
  #state: EngineState;
  readonly #snapshots: SnapshotStore;
  readonly #snapshotEveryMs: number;
  readonly #replayWindowMs: number;
  /** Applied frames in frame order; they hold every frame after the snapshot a target inside the window restores. */
  #frames: Frame[] = [];
  #lastOverallFrameId: number;

  constructor(init: Parameters<typeof initialState>[0], opts: SessionRunnerOptions = {}) {
    this.#state = initialState(init);
    this.#snapshotEveryMs = opts.snapshotEveryMs ?? 1000;
    this.#replayWindowMs = opts.replayWindowMs ?? 10_000;
    this.#snapshots = new SnapshotStore(this.#state, -1);
    this.#lastOverallFrameId = init.session.header.overallFrameIdentifier;
  }

  get state(): DeepReadonly<EngineState> {
    return this.#state;
  }

  apply(frame: Frame): StepResult {
    const before = historyLengths(this.#state.history);
    const target = this.#flashbackTarget(frame);
    const flashback = target && this.#rewind(target);
    const { changed, corrections } = step(this.#state, frame);
    this.#lastOverallFrameId = frame.overallFrameId;
    this.#keep(frame);
    return {
      state: this.#state,
      changed: flashback ? new Set(ALL_CHANGE_TAGS) : changed,
      corrections,
      delta: { before, after: historyLengths(this.#state.history), truncated: flashback !== undefined },
      ...(flashback && { flashback }),
    };
  }

  /** The `FLBK` event's target, else the frame before this one when `frameId` went back while `overallFrameId` rose. */
  #flashbackTarget(frame: Frame): Target | undefined {
    const event = frame.events.map((e) => e.details).find(isFlashback);
    const target: Target | undefined = event
      ? { frameId: event.flashbackFrameIdentifier, sessionTime: toSessionTime(event.flashbackSessionTime) }
      : frame.frameId < this.#state.lastFrameId && frame.overallFrameId > this.#lastOverallFrameId
        ? { frameId: frame.frameId - 1 }
        : undefined;
    return target && target.frameId < this.#state.lastFrameId ? target : undefined;
  }

  #rewind(target: Target): FlashbackInfo {
    const rewoundFrom = this.#state.sessionTime;
    const snapshot = this.#snapshots.newestAtOrBefore(target.frameId);
    this.#snapshots.dropAfter(snapshot.frameId);
    const { history } = this.#state;
    truncateHistory(history, snapshot.lengths);
    this.#state = { ...structuredClone(snapshot.state), history };
    // A target older than the window has no kept frames after its snapshot: the snapshot's state stands for it.
    for (const f of this.#frames) if (f.frameId > snapshot.frameId && f.frameId <= target.frameId) step(this.#state, f);
    this.#frames = this.#frames.filter((f) => f.frameId <= target.frameId);
    const targetSessionTime = target.sessionTime ?? this.#state.sessionTime;
    return {
      targetFrameId: target.frameId,
      targetSessionTime,
      rewoundMs: rewoundFrom - targetSessionTime,
      targetLap: this.#state.cars[this.#state.playerCar]?.timing.lap ?? 0,
    };
  }

  /** Keeps the applied frame; once per `snapshotEveryMs` takes a snapshot and drops the frames no replay needs. */
  #keep(frame: Frame): void {
    this.#frames.push(frame);
    if (frame.sessionTime < this.#snapshots.newest.sessionTime + this.#snapshotEveryMs) return;
    this.#snapshots.take(this.#state, frame.frameId);
    // The snapshot a target at the start of the window restores; the frames up to it are never replayed.
    const windowStart = this.#snapshots.newestAtOrBeforeTime(frame.sessionTime - this.#replayWindowMs);
    const firstNeeded = this.#frames.findIndex((f) => f.frameId > windowStart.frameId);
    this.#frames.splice(0, firstNeeded < 0 ? this.#frames.length : firstNeeded);
  }
}
