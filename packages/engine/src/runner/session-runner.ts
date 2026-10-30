import { toSessionTime, type Ms, type SessionTime } from '@pitwall/domain';
import type { EventDetails } from '@pitwall/protocol';
import type { Frame } from '../frame/frame.ts';
import { dropRecordedAfter } from '../history/clock-reset.ts';
import { historyLengths, truncateHistory, type HistoryDelta } from '../history/delta.ts';
import type { EngineState } from '../state/engine-state.ts';
import { initialState } from '../step/initial-state.ts';
import { ALL_CHANGE_TAGS, step, type ChangeTag, type LapCorrection } from '../step/step.ts';
import { copyPlain } from '../util/copy-plain.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import { SnapshotStore } from './snapshots.ts';

/** Where a flashback took the session: the game's target frame, its session time and the player's lap there. */
export type FlashbackInfo = { targetFrameId: number; targetSessionTime: SessionTime; rewoundMs: Ms; targetLap: number };

/**
 * The game set the session time back from `fromMs` to `toMs` without a flashback (at the end of the formation lap):
 * the history recorded after `toMs` is gone, the cars carry on.
 */
export type ClockReset = { fromMs: SessionTime; toMs: SessionTime };

/**
 * What applying one frame did. On a flashback or a clock reset `changed` holds every tag and `delta.truncated` is
 * true; `flashback` or `clockReset` tells which of the two it was.
 */
export type StepResult = {
  state: DeepReadonly<EngineState>;
  changed: Set<ChangeTag>;
  corrections: LapCorrection[];
  delta: HistoryDelta;
  flashback?: FlashbackInfo;
  clockReset?: ClockReset;
};

export type SessionRunnerOptions = {
  /** Session time between two snapshots. */
  snapshotEveryMs?: number;
  /** Session time of applied frames kept for a replay, so a flashback inside it restores the exact target state. */
  replayWindowMs?: number;
};

/**
 * Frames per second of session time that the frame bounds allow for: 60 Hz with twice the headroom. While session
 * time stands still, snapshots and the replay window go by frame count instead, so the kept frames stay bounded.
 */
const MAX_FRAMES_PER_SECOND = 120;
const framesIn = (ms: number): number => Math.ceil((ms / 1000) * MAX_FRAMES_PER_SECOND);

/** A fall of the session time by more than this, with no flashback, is a clock reset. */
const CLOCK_RESET_FALL_MS = 1000;

/** The frame a flashback goes back to; without an `FLBK` event its session time is only known after the replay. */
type Target = { frameId: number; sessionTime?: SessionTime };

type FlashbackDetails = Extract<EventDetails, { code: 'FLBK' }>;
const isFlashback = (details: EventDetails): details is FlashbackDetails => details.code === 'FLBK';

/**
 * Runs one session's frames through `step` and handles flashbacks (spec 5.4): it takes a snapshot every
 * `snapshotEveryMs` of session time and keeps the frames of the last `replayWindowMs`. A flashback restores the
 * newest snapshot at or before the target, cuts the history back, replays the kept frames up to the target and
 * then applies the game's new frame, so the discarded frames leave no trace. A clock reset drops the history recorded
 * after the new session time and every snapshot and kept frame, so no later rewind goes back before it.
 */
export class SessionRunner {
  #state: EngineState;
  readonly #snapshots: SnapshotStore;
  readonly #snapshotEveryMs: number;
  readonly #snapshotEveryFrames: number;
  /** Applied frames, ids strictly rising; they hold every frame after the snapshot at the replay window's start. */
  #frames: Frame[] = [];
  #lastOverallFrameId: number;
  /**
   * The target of the last rewind, until the new timeline has moved past the frame after it. The game can report
   * one flashback twice (an `FLBK` event and the `frameId` drop, in different frames); this is that second report.
   */
  #rewoundTo: number | undefined;

  constructor(init: Parameters<typeof initialState>[0], opts: SessionRunnerOptions = {}) {
    const replayWindowMs = opts.replayWindowMs ?? 10_000;
    this.#state = initialState(init);
    this.#snapshotEveryMs = opts.snapshotEveryMs ?? 1000;
    this.#snapshotEveryFrames = framesIn(this.#snapshotEveryMs);
    this.#snapshots = new SnapshotStore(this.#state, -1, { ms: replayWindowMs, frames: framesIn(replayWindowMs) });
    this.#lastOverallFrameId = init.session.header.overallFrameIdentifier;
  }

  /** The current state. A rewind replaces the object, so read it again after every `apply` instead of keeping it. */
  get state(): DeepReadonly<EngineState> {
    return this.#state;
  }

  /** How many snapshots and frames are kept for rewinds. */
  get retained(): { snapshots: number; frames: number } {
    return { snapshots: this.#snapshots.size, frames: this.#frames.length };
  }

  apply(frame: Frame): StepResult {
    const before = historyLengths(this.#state.history);
    const target = this.#flashbackTarget(frame);
    const flashback = target && this.#rewind(target, frame);
    const clockReset = target ? undefined : this.#clockReset(frame);
    if (clockReset) dropRecordedAfter(this.#state, clockReset.toMs);
    const { changed, corrections } = step(this.#state, frame);
    this.#lastOverallFrameId = frame.overallFrameId;
    if (target) this.#rewoundTo = target.frameId;
    else if (this.#rewoundTo !== undefined && frame.frameId > this.#rewoundTo + 1) this.#rewoundTo = undefined;
    if (clockReset) this.#restart();
    else this.#keep(frame);
    const truncated = flashback !== undefined || clockReset !== undefined;
    return {
      state: this.#state,
      changed: truncated ? new Set(ALL_CHANGE_TAGS) : changed,
      corrections,
      delta: { before, after: historyLengths(this.#state.history), truncated },
      ...(flashback && { flashback }),
      ...(clockReset && { clockReset }),
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
    return target && target.frameId < this.#state.lastFrameId && target.frameId !== this.#rewoundTo ? target : undefined;
  }

  /**
   * A clock reset: the session time falls by more than `CLOCK_RESET_FALL_MS` while the frame id does not go back and
   * no `FLBK` comes. An `FLBK` or a frame-id drop is a flashback, also when it is a second report that is ignored.
   */
  #clockReset(frame: Frame): ClockReset | undefined {
    const fromMs = this.#state.sessionTime;
    const fell = frame.sessionTime < fromMs - CLOCK_RESET_FALL_MS;
    const noFlashback = frame.frameId >= this.#state.lastFrameId && !frame.events.some((e) => isFlashback(e.details));
    return fell && noFlashback ? { fromMs, toMs: frame.sessionTime } : undefined;
  }

  /**
   * Restores the state after the target frame, or after the frame before `frame` when the game sends `frame` with an
   * id at or below the target: the state never runs ahead of the frame applied next.
   */
  #rewind(target: Target, frame: Frame): FlashbackInfo {
    const rewoundFrom = this.#state.sessionTime;
    const replayTo = Math.min(target.frameId, frame.frameId - 1);
    const snapshot = this.#snapshots.newestAtOrBefore(replayTo);
    this.#snapshots.dropAfter(snapshot.frameId);
    const { history, weekend } = this.#state;
    truncateHistory(history, snapshot.lengths);
    this.#state = { ...copyPlain(snapshot.state), history, ...(weekend && { weekend }) };
    // A target older than the window has no kept frames after its snapshot: the snapshot's state stands for it.
    for (const f of this.#frames) if (f.frameId > snapshot.frameId && f.frameId <= replayTo) step(this.#state, f);
    this.#frames = this.#frames.filter((f) => f.frameId <= replayTo);
    const targetSessionTime = target.sessionTime ?? this.#state.sessionTime;
    return {
      targetFrameId: target.frameId,
      targetSessionTime,
      rewoundMs: rewoundFrom - targetSessionTime,
      targetLap: this.#state.cars[this.#state.playerCar]?.timing.lap ?? 0,
    };
  }

  /** After a clock reset: the state after its frame becomes the first snapshot, and the older ones and the kept frames go. */
  #restart(): void {
    this.#snapshots.restart(this.#state, this.#state.lastFrameId);
    this.#frames = [];
  }

  /**
   * Keeps the applied frame. Once per `snapshotEveryMs` of session time (or the frames that many ms take at most)
   * takes a snapshot and drops the frames no replay needs.
   */
  #keep(frame: Frame): void {
    // A frame id at or below kept ones (a flashback, or a report of one that was ignored) makes those stale.
    this.#snapshots.dropAfter(frame.frameId - 1);
    while ((this.#frames.at(-1)?.frameId ?? -Infinity) >= frame.frameId) this.#frames.pop();
    this.#frames.push(frame);
    const newest = this.#snapshots.newest;
    const due = frame.sessionTime >= newest.sessionTime + this.#snapshotEveryMs || frame.frameId >= newest.frameId + this.#snapshotEveryFrames;
    if (!due) return;
    this.#snapshots.take(this.#state, frame.frameId);
    const start = this.#snapshots.windowStart.frameId;
    const firstNeeded = this.#frames.findIndex((f) => f.frameId > start);
    this.#frames.splice(0, firstNeeded < 0 ? this.#frames.length : firstNeeded);
  }
}
