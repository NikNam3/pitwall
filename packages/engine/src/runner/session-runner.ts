import { toSessionTime, type Ms, type ParticipantsValues, type SessionTime } from '@pitwall/domain';
import type { Frame } from '../frame/frame.ts';
import { logWriter, voidFactOf } from '../log/log.ts';
import { projectionLengths } from '../log/projection.ts';
import type { HistoryDelta, LogVoidFact } from '../log/types.ts';
import { onRaceClock, rewindMarkOf } from '../situations/clock/clock.ts';
import { closeSession, situationOf } from '../situations/run.ts';
import type { EngineState } from '../state/engine-state.ts';
import type { WeekendContext } from '../state/weekend-context.ts';
import { participantsValuesOf } from '../step/state-update/identity.ts';
import { initialState } from '../step/state-update/initial.ts';
import { ALL_CHANGE_TAGS, projectionTrackerOf, step, type ChangeTag, type ClockFall, type ClockJump, type FlashbackReport, type LapCorrection } from '../step/step.ts';
import { copyPlain } from '../util/copy-plain.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { Snapshotable } from './snapshotable.ts';
import { SnapshotStore } from './snapshots.ts';

/** Where a flashback took the session: the game's target frame, its time on the race clock and the player's lap there. */
export type FlashbackInfo = { targetFrameId: number; targetSessionTime: SessionTime; rewoundMs: Ms; targetLap: number };

/**
 * Where a step of an old mechanism that cuts or rewrites what was recorded sends readers back to: the session's start.
 * It undoes no frame. Until the situation tracker stops rewriting (Task 9), each of them is `delta.rewound` with this
 * target.
 */
const LEGACY_REWIND: LogVoidFact['target'] = { frameId: -1, at: toSessionTime(0) };

/**
 * What applying one frame did. When it changed history recorded before it (a flashback, lights out discarding the
 * formation lap) or took back what readers saw (a neutralisation dropped
 * unconfirmed; a session phase opening or closing at or before the time of an entry earlier frames recorded), `changed`
 * holds every tag and `delta.rewound` is set: a flashback's void target (the frame restored to, at its time on the race
 * clock), else `LEGACY_REWIND`; `flashback` tells a flashback. `clockFall` reports a fall of the
 * session time that changed nothing recorded (carried over, C36), `clockJump` a forward jump that is no post-session jump (spec 3.3); both
 * carry the game's times. Every other session time is on the race clock.
 */
export type StepResult = {
  state: DeepReadonly<EngineState>;
  changed: Set<ChangeTag>;
  corrections: LapCorrection[];
  delta: HistoryDelta;
  flashback?: FlashbackInfo;
  clockFall?: ClockFall;
  clockJump?: ClockJump;
};

export type { Snapshotable } from './snapshotable.ts';

/** Called once for each frame the runner applies, in order, right after that frame's step. */
export type OnResult = (result: StepResult, frame: Frame) => void;

export type SessionRunnerOptions = {
  /**
   * The bookkeeping of what reads the results (the scheduler). The runner saves it after each kept frame's result was
   * handed out and with each snapshot, and restores it with the state on a flashback, as it stood after the target.
   */
  attach?: Snapshotable<unknown>;
  /** The weekend context of the session's player, asked once when the identity wait ends (the caller reads storage). */
  contextFor?: (participants: ParticipantsValues | undefined) => WeekendContext | undefined;
};

/**
 * Frames held until the first Participants packet names the player's driver (and so the weekend context): about 10 s
 * at 60 Hz. Then the session starts without one.
 */
export const IDENTITY_WAIT_FRAMES = 600;
/** Session time between two snapshots. */
const SNAPSHOT_EVERY_MS = 1000;
/** Session time of applied frames kept for a replay, so a flashback inside it restores the exact target state. */
const REPLAY_WINDOW_MS = 10_000;

/**
 * Frames per second of session time that the frame bounds allow for: 60 Hz with twice the headroom. While session
 * time stands still, snapshots and the replay window go by frame count instead, so the kept frames stay bounded.
 */
const MAX_FRAMES_PER_SECOND = 120;
const framesIn = (ms: number): number => Math.ceil((ms / 1000) * MAX_FRAMES_PER_SECOND);

/** The frame a flashback goes back to; without an `FLBK` event its session time is only known after the replay. */
type Target = { frameId: number; sessionTime?: SessionTime };

/**
 * An applied frame and the runner's decision on it, given again to `step` whenever a rewind replays the frame; `at`: the
 * session time on the race clock after it; `attached`: the attached bookkeeping once its result was handed out.
 */
type Kept = { frame: Frame; report?: FlashbackReport; at: SessionTime; attached: unknown };

/**
 * Runs one session's frames through `step` and handles flashbacks (spec 5.4). Frames wait until the first Participants
 * packet, at most `IDENTITY_WAIT_FRAMES`, so the weekend context (`contextFor`) is known before the first step (C61).
 * The runner takes a snapshot every `SNAPSHOT_EVERY_MS` of session time and keeps the frames of the last
 * `REPLAY_WINDOW_MS`. A flashback restores the newest snapshot at or before the target, appends one void fact over what
 * the log gained since (C27; nothing is removed), replays the kept frames up to the target, restores the attached
 * bookkeeping as it stood there and then applies the game's new frame, so the discarded frames leave no trace in what
 * readers see. A step that rewrote earlier history (the situation tracker's formation discard) drops every snapshot and
 * kept frame, so no later rewind goes back before it. The runner alone decides what reports a flashback; it hands that
 * decision to `step` with the frame (a `FlashbackReport`) and keeps it with the frame for every replay. Every other
 * session-time jump is the clock's (step 0, `situations/clock/`).
 */
export class SessionRunner {
  #state: EngineState;
  readonly #snapshots: SnapshotStore;
  readonly #snapshotEveryFrames = framesIn(SNAPSHOT_EVERY_MS);
  readonly #attach: Snapshotable<unknown> | undefined;
  readonly #contextFor: SessionRunnerOptions['contextFor'];
  /** The identity wait lasts: frames are held until Participants or `IDENTITY_WAIT_FRAMES`. */
  #waiting = true;
  /**
   * Frames to apply, oldest first: the identity wait's, then the frames given since. Each leaves the queue before its
   * step, so one that throws is skipped and the next `apply` or `end` applies the rest.
   */
  readonly #queue: Frame[] = [];
  /** The frame whose step runs, or threw: `undefined` once it was applied. */
  #applying: Frame | undefined;
  /** Applied frames, ids strictly rising; they hold every frame after the snapshot at the replay window's start. */
  #frames: Kept[] = [];
  #lastOverallFrameId: number;
  /**
   * The target of the last rewind, until the new timeline has moved past the frame after it. The game can report
   * one flashback twice (an `FLBK` event and the `frameId` drop, in different frames); this is that second report.
   */
  #rewoundTo: number | undefined;
  /** A frame was applied. Before the first there is nothing to rewind, so no frame reports a flashback (review 6 R6-1). */
  #applied = false;

  constructor(init: Parameters<typeof initialState>[0], opts: SessionRunnerOptions = {}) {
    this.#state = initialState(init);
    this.#attach = opts.attach;
    this.#contextFor = opts.contextFor;
    const window = { ms: REPLAY_WINDOW_MS, frames: framesIn(REPLAY_WINDOW_MS) };
    this.#snapshots = new SnapshotStore(this.#state, -1, window, this.#attach?.snapshot());
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

  /** The frame being applied: after `apply` or `end` threw, the frame whose step threw (it is skipped). */
  get applying(): Frame | undefined {
    return this.#applying;
  }

  /**
   * Applies the frame, or holds it while the identity wait lasts; the frame that ends the wait applies every held
   * frame, in order, and so does the next call after a step threw. `onResult` gets each applied frame's result right
   * after its step (`result.state` is the state after that frame).
   */
  apply(frame: Frame, onResult?: OnResult): void {
    this.#queue.push(frame);
    if (this.#waiting) {
      if (frame.participants !== undefined) this.#endWait(participantsValuesOf(frame, frame.participants));
      else if (this.#queue.length >= IDENTITY_WAIT_FRAMES) this.#endWait(undefined);
      else return;
    }
    this.#drain(onResult);
  }

  /** The session ended: the frames still held (no Participants came) are applied, with no weekend context. */
  end(onResult?: OnResult): void {
    if (this.#waiting && this.#queue.length > 0) this.#endWait(undefined);
    if (!this.#waiting) this.#drain(onResult);
  }

  /**
   * The session is over (the bridge calls it on `sessionEnded`: SEND, a new session, the end of input): the frames
   * still held are applied (`end`), then every open span is closed at the last frame's time (`closeSession`, C18), so
   * the log is complete, and the projection takes the closed spans in.
   */
  finish(onResult?: OnResult): void {
    this.end(onResult);
    closeSession(this.#state, this.#state.sessionTime);
    projectionTrackerOf(this.#state).update(situationOf(this.#state));
  }

  /** Asks `contextFor` once: the held frames are then applied. */
  #endWait(participants: ParticipantsValues | undefined): void {
    this.#waiting = false;
    const weekend = this.#contextFor?.(participants);
    if (weekend !== undefined) this.#state.weekend = weekend;
  }

  /** Applies the queued frames in order; each leaves the queue before its step. */
  #drain(onResult: OnResult | undefined): void {
    for (let frame = this.#queue.shift(); frame !== undefined; frame = this.#queue.shift()) {
      this.#applying = frame;
      this.#applyNow(frame, onResult);
      this.#applying = undefined;
    }
  }

  #applyNow(frame: Frame, onResult: OnResult | undefined): void {
    const before = projectionLengths(this.#state.history);
    const reported = this.#reportedTarget(frame);
    const target = reported && this.#takes(reported) ? reported : undefined;
    // The runner's decision on the frame; a rewind's mark is of the state it leaves, so taken before restoring.
    const report: FlashbackReport | undefined = reported && (target ? { rewound: rewindMarkOf(this.#state) } : {});
    const rewind = target && this.#rewind(target, frame);
    const { changed, corrections, rewritten, discarded, clockFall, clockJump } = step(this.#state, frame, report);
    this.#applied = true;
    this.#lastOverallFrameId = frame.overallFrameId;
    if (target) this.#rewoundTo = target.frameId;
    else if (this.#rewoundTo !== undefined && frame.frameId > this.#rewoundTo + 1) this.#rewoundTo = undefined;
    const rewound = rewind?.target ?? (rewritten === true || discarded === true ? { ...LEGACY_REWIND } : undefined);
    onResult?.(
      {
        state: this.#state,
        changed: rewound ? new Set(ALL_CHANGE_TAGS) : changed,
        corrections,
        delta: { before, after: projectionLengths(this.#state.history), ...(rewound && { rewound }) },
        ...(rewind && { flashback: rewind.flashback }),
        ...(clockFall && { clockFall }),
        ...(clockJump && { clockJump }),
      },
      frame,
    );
    // After the result was handed out: the attached bookkeeping has taken the frame in.
    const attached = this.#attach?.snapshot();
    if (rewritten) this.#restart(attached);
    else this.#keep({ frame, ...(report && { report }), at: this.#state.sessionTime, attached });
  }

  /**
   * The flashback the frame reports: an `FLBK` event's target (`frame.flashback`, from frame assembly), else the frame before this one when `frameId` went back
   * while `overallFrameId` rose. A `frameId` going back while `overallFrameId` does not rise reports none, and so does
   * the session's first frame (a live join, or a cut segment whose first frame carries an `FLBK` to a frame before
   * it): the engine never saw the far side of that rewind, so the frame is applied as the session's first.
   */
  #reportedTarget(frame: Frame): Target | undefined {
    if (!this.#applied) return undefined;
    if (frame.flashback) return { frameId: frame.flashback.targetFrameId, sessionTime: frame.flashback.targetSessionTime };
    return frame.frameId < this.#state.lastFrameId && frame.overallFrameId > this.#lastOverallFrameId ? { frameId: frame.frameId - 1 } : undefined;
  }

  /** A report is taken when its target lies behind the state and it is not the second report of the last rewind. */
  #takes(target: Target): boolean {
    return target.frameId < this.#state.lastFrameId && target.frameId !== this.#rewoundTo;
  }

  /**
   * Restores the state after the target frame, or after the frame before `frame` when the game sends `frame` with an
   * id at or below the target: the state never runs ahead of the frame applied next. The void fact covers what the log
   * gained since the restored snapshot; its target is the frame restored to, at its time on the race clock (the
   * snapshot's own when the target is older than the replay window; `flashback` keeps the game's target). Each
   * replayed frame gets the runner's decision it got when first applied and appends its facts again after the void.
   */
  #rewind(target: Target, frame: Frame): { flashback: FlashbackInfo; target: LogVoidFact['target'] } {
    const rewoundFrom = this.#state.sessionTime;
    const replayTo = Math.min(target.frameId, frame.frameId - 1);
    const snapshot = this.#snapshots.newestAtOrBefore(replayTo);
    this.#snapshots.dropAfter(snapshot.frameId);
    // A target older than the window has no kept frames after its snapshot: the snapshot's state stands for it.
    const replayed = this.#frames.filter(({ frame: f }) => f.frameId > snapshot.frameId && f.frameId <= replayTo);
    this.#frames = this.#frames.filter(({ frame: f }) => f.frameId <= replayTo);
    const { log, history, weekend } = this.#state;
    this.#state = { ...copyPlain(snapshot.state), log, history, ...(weekend && { weekend }) };
    // The frame restored to: the last replayed one, or the snapshot's when the target is older than the window.
    const last = replayed.at(-1);
    const voidTarget = last === undefined ? { frameId: snapshot.frameId, at: snapshot.sessionTime } : { frameId: last.frame.frameId, at: last.at };
    logWriter(log).append('voids', voidFactOf(log, snapshot.lengths, voidTarget));
    // The new void fact projects the log again (C30), before the replayed frames extend it.
    projectionTrackerOf(this.#state).update(situationOf(this.#state));
    for (const { frame: f, report } of replayed) step(this.#state, f, report);
    this.#attach?.restore(last === undefined ? snapshot.attached : last.attached);
    const targetSessionTime = target.sessionTime === undefined ? this.#state.sessionTime : onRaceClock(this.#state, target.sessionTime);
    const flashback = {
      targetFrameId: target.frameId,
      targetSessionTime,
      rewoundMs: rewoundFrom - targetSessionTime,
      targetLap: this.#state.cars[this.#state.playerCar]?.timing.lap ?? 0,
    };
    return { flashback, target: voidTarget };
  }

  /** After a step that rewrote history: the state after its frame becomes the first snapshot, and the older ones and the kept frames go. */
  #restart(attached: unknown): void {
    this.#snapshots.restart(this.#state, this.#state.lastFrameId, attached);
    this.#frames = [];
  }

  /**
   * Keeps the applied frame. Once per `SNAPSHOT_EVERY_MS` of session time (or the frames that many ms take at most)
   * takes a snapshot and drops the frames no replay needs.
   */
  #keep(kept: Kept): void {
    const { frame } = kept;
    // A frame id at or below kept ones (a flashback, or a report of one that was ignored) makes those stale.
    this.#snapshots.dropAfter(frame.frameId - 1);
    while ((this.#frames.at(-1)?.frame.frameId ?? -Infinity) >= frame.frameId) this.#frames.pop();
    this.#frames.push(kept);
    const newest = this.#snapshots.newest;
    const due = this.#state.sessionTime >= newest.sessionTime + SNAPSHOT_EVERY_MS || frame.frameId >= newest.frameId + this.#snapshotEveryFrames;
    if (!due) return;
    this.#snapshots.take(this.#state, frame.frameId, kept.attached);
    const start = this.#snapshots.windowStart.frameId;
    const firstNeeded = this.#frames.findIndex(({ frame: f }) => f.frameId > start);
    this.#frames.splice(0, firstNeeded < 0 ? this.#frames.length : firstNeeded);
  }
}
