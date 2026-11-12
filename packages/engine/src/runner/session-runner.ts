import type { FrameNumber, GivenDecision, Ms, ParticipantsValues, SessionTime } from '@pitwall/domain';
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
import { copyPlainSharingKnown } from '../util/copy-plain.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { Snapshotable } from './snapshotable.ts';
import { SnapshotStore } from './snapshots.ts';

/** Where a flashback took the session: the game's target frame, its time on the race clock and the player's lap there. */
export type FlashbackInfo = { targetFrameId: number; targetSessionTime: SessionTime; rewoundMs: Ms; targetLap: number };

/**
 * What applying one frame did. On a flashback (C27, the only rewind: no step changes what was recorded, C24) `changed`
 * holds every tag, `delta.rewound` is the void fact's target (the frame restored to, at its time on the race clock; its
 * frame id is -1 for a flashback to the first snapshot, the state before the session's first frame) and `flashback`
 * tells where the game went. `clockFall` reports a fall of the session time that changed nothing recorded (carried over,
 * C36), `clockJump` a forward jump that is no post-session jump (spec 3.3); both carry the game's times. Every other
 * session time is on the race clock.
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
/**
 * Session time of applied frames kept for a replay, with no snapshot thinned: a flashback inside it (the game's go 15 s
 * back) restores the exact target state. A deeper one restores the newest snapshot at or before its target.
 */
const REPLAY_WINDOW_MS = 30_000;

/**
 * Frames per second of session time that the frame bounds allow for: 60 Hz with twice the headroom. While session
 * time stands still, snapshots and the replay window go by frame count instead, so the kept frames stay bounded.
 */
const MAX_FRAMES_PER_SECOND = 120;
const framesIn = (ms: number): number => Math.ceil((ms / 1000) * MAX_FRAMES_PER_SECOND);

/** The length of every span list of the log, by machine. */
const spanLengths = (state: DeepReadonly<EngineState>): Record<string, number> =>
  Object.fromEntries(Object.entries(state.log.spans).map(([machine, spans]) => [machine, spans.length]));

/** The frame a flashback goes back to; without an `FLBK` event its session time is only known after the replay. */
type Target = { frameId: number; sessionTime?: SessionTime };

/** The decisions the user committed with a frame (C76): as the bridge hands them, without the frame the recorder adds. */
type GivenDecisions = readonly GivenDecision[];

/** A frame given to `apply`, with the decisions committed at it; absent means none. */
type Given = { frame: Frame; decisions?: GivenDecisions };

/**
 * An applied frame with its decisions and the runner's decision on it, given again to `step` whenever a rewind replays
 * the frame (so a decision of a frame up to the target comes back, one after it does not, C27a); `number`: its frame
 * number (C26), which tells apart frames sharing a frame id; `at`: the session time on the race clock after it;
 * `attached`: the attached bookkeeping once its result was handed out.
 */
type Kept = Given & { report?: FlashbackReport; number: FrameNumber; at: SessionTime; attached: unknown };

/**
 * Runs one session's frames through `step` and handles flashbacks (spec 5.4). Frames wait until the first Participants
 * packet, at most `IDENTITY_WAIT_FRAMES`, so the weekend context (`contextFor`) is known before the first step (C61).
 * The runner takes a snapshot every `SNAPSHOT_EVERY_MS` of session time and keeps the frames of the last
 * `REPLAY_WINDOW_MS`. A flashback restores the newest snapshot at or before the target, appends one void fact over what
 * the log gained since (C27; nothing is removed), replays the kept frames up to the target and restores the attached
 * bookkeeping as it stood there, so the discarded frames leave no trace in what readers see. A frame reporting an `FLBK`
 * above its target is the undone timeline's last tick: the runner rewinds on it and never steps it, and the game's new
 * frame comes next; any other frame that rewinds is stepped after the rewind. The runner alone decides what reports a
 * flashback; it hands that decision to `step` with the frame (a `FlashbackReport`; an undone tick's, with the next frame
 * stepped) and keeps it with the frame for every replay. Every other session-time jump is the clock's (step 0,
 * `situations/clock/`).
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
  readonly #queue: Given[] = [];
  /** The frame whose step runs, or threw: `undefined` once it was applied. */
  #applying: Frame | undefined;
  /**
   * Applied frames, ids never falling (two share one where a new timeline's first tick lands on its rewind's target);
   * they hold every frame after the snapshot at the replay window's start.
   */
  #frames: Kept[] = [];
  #lastOverallFrameId: number;
  /**
   * The target of the last rewind, until the new timeline has moved past the frame after it. The game can report
   * one flashback twice (an `FLBK` event and the `frameId` drop, in different frames); this is that second report.
   */
  #rewoundTo: number | undefined;
  /** The flashback report of an undone tick, until the next frame stepped takes it. */
  #undoneReport: FlashbackReport | undefined;
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
   * after its step (`result.state` is the state after that frame). `decisions`: the decisions the user committed at the
   * frame (C10, C76), appended by the decision recorder describing it, and given again whenever a rewind replays it.
   */
  apply(frame: Frame, onResult?: OnResult, decisions?: GivenDecisions): void {
    this.#queue.push({ frame, ...(decisions && decisions.length > 0 && { decisions }) });
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
   * still held are applied (`end`, through `onResult`), then every open span is closed at the last frame's time
   * (`closeSession`, C18), so the log is complete, and the projection takes the closed spans in. Returns the closing
   * result: `changed` holds the `spans:<machine>` tag of every span list of the log that grew (the clock's included),
   * `delta` the projection's update, so storage writes the closing spans and the situation topics publish them (C54).
   */
  finish(onResult?: OnResult): StepResult {
    this.end(onResult);
    const spansBefore = spanLengths(this.#state);
    closeSession(this.#state, this.#state.sessionTime);
    const delta = projectionTrackerOf(this.#state).update(situationOf(this.#state), this.#state.frameNumber + 1);
    const spansAfter = spanLengths(this.#state);
    const changed = new Set<ChangeTag>();
    for (const [machine, length] of Object.entries(spansAfter)) {
      if (length > (spansBefore[machine] ?? 0)) changed.add(`spans:${machine}` as ChangeTag);
    }
    return { state: this.#state, changed, corrections: [], delta };
  }

  /** Asks `contextFor` once: the held frames are then applied. */
  #endWait(participants: ParticipantsValues | undefined): void {
    this.#waiting = false;
    const weekend = this.#contextFor?.(participants);
    if (weekend !== undefined) this.#state.weekend = weekend;
  }

  /** Applies the queued frames in order; each leaves the queue before its step. */
  #drain(onResult: OnResult | undefined): void {
    for (let given = this.#queue.shift(); given !== undefined; given = this.#queue.shift()) {
      this.#applying = given.frame;
      this.#applyNow(given, onResult);
      this.#applying = undefined;
    }
  }

  #applyNow({ frame, decisions }: Given, onResult: OnResult | undefined): void {
    // The projection's lengths as its last update left them (`open.projection.lengths`, its book).
    const before = this.#state.open.projection.lengths;
    const reported = this.#reportedTarget(frame);
    const target = reported && this.#takes(reported) ? reported : undefined;
    // A rewind's mark is of the state it leaves, so taken before restoring; an undone tick before it left that tick.
    const left = target && (this.#undoneReport?.rewound ?? rewindMarkOf(this.#state));
    const rewind = target && this.#rewind(target, frame);
    if (left && rewind && frame.flashback && frame.frameId > frame.flashback.targetFrameId) {
      this.#undoneReport = { rewound: { ...left, frameId: frame.frameId, rawMs: frame.sessionTime } };
      this.#lastOverallFrameId = frame.overallFrameId;
      this.#rewoundTo = rewind.flashback.targetFrameId;
      const delta = { before, after: projectionLengths(this.#state.history), rewound: rewind.target };
      onResult?.({ state: this.#state, changed: new Set(ALL_CHANGE_TAGS), corrections: [], delta, flashback: rewind.flashback }, frame);
      return;
    }
    // The runner's decision on the frame: its own rewind, an undone tick's just before it, or a report it did not take.
    const report: FlashbackReport | undefined = left ? { rewound: left } : (this.#undoneReport ?? (reported && {}));
    const { changed, corrections, clockFall, clockJump } = step(this.#state, frame, report, decisions);
    this.#undoneReport = undefined;
    this.#applied = true;
    this.#lastOverallFrameId = frame.overallFrameId;
    if (target) this.#rewoundTo = target.frameId;
    else if (this.#rewoundTo !== undefined && frame.frameId > this.#rewoundTo + 1) this.#rewoundTo = undefined;
    const rewound = rewind?.target;
    onResult?.(
      {
        state: this.#state,
        changed: rewound ? new Set(ALL_CHANGE_TAGS) : changed,
        corrections,
        delta: { before, after: this.#state.open.projection.lengths, ...(rewound && { rewound }) },
        ...(rewind && { flashback: rewind.flashback }),
        ...(clockFall && { clockFall }),
        ...(clockJump && { clockJump }),
      },
      frame,
    );
    // After the result was handed out: the attached bookkeeping has taken the frame in.
    const attached = this.#attach?.snapshot();
    this.#keep({ frame, ...(decisions && { decisions }), ...(report && { report }), number: this.#state.frameNumber, at: this.#state.sessionTime, attached });
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
   * snapshot's own when the target is older than the replay window; `flashback` keeps the game's target), and its frame
   * number (C26). The restored state carries the snapshot's frame number, so each replayed frame counts again and gets
   * the number of its first pass (C33). Each replayed frame gets the runner's decision it got when first applied and the
   * user's decisions committed with it, and appends its facts again after the void; a frame after the target is not
   * replayed, so its decisions stay voided (C27a). The frames to replay go by frame number from the snapshot, as frame
   * ids can repeat, and by frame id up to the game's target, so a target's id replays every frame that has it.
   */
  #rewind(target: Target, frame: Frame): { flashback: FlashbackInfo; target: LogVoidFact['target'] } {
    const rewoundFrom = this.#state.sessionTime;
    const replayTo = Math.min(target.frameId, frame.frameId - 1);
    const snapshot = this.#snapshots.newestAtOrBefore(replayTo);
    this.#snapshots.dropAfter(snapshot.frameId);
    // A target older than the window has no kept frames after its snapshot: the snapshot's state stands for it.
    const replayed = this.#frames.filter(({ frame: f, number }) => number > snapshot.state.frameNumber && f.frameId <= replayTo);
    this.#frames = this.#frames.filter(({ frame: f }) => f.frameId <= replayTo);
    const { log, history, weekend } = this.#state;
    this.#state = { ...copyPlainSharingKnown(snapshot.state), log, history, ...(weekend && { weekend }) };
    // The frame restored to: the last replayed one, or the snapshot's when the target is older than the window. Its
    // frame number: the snapshot's, counted on by each replayed frame (C26).
    const last = replayed.at(-1);
    const voidTarget = last === undefined ? { frameId: snapshot.frameId, at: snapshot.sessionTime } : { frameId: last.frame.frameId, at: last.at };
    logWriter(log).append('voids', voidFactOf(log, snapshot.lengths, voidTarget, snapshot.state.frameNumber + replayed.length));
    // The new void fact projects the log again (C30), before the replayed frames extend it.
    projectionTrackerOf(this.#state).update(situationOf(this.#state), this.#state.frameNumber);
    for (const { frame: f, report, decisions } of replayed) step(this.#state, f, report, decisions);
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

  /**
   * Keeps the applied frame. Once per `SNAPSHOT_EVERY_MS` of session time (or the frames that many ms take at most)
   * takes a snapshot and drops the frames no replay needs.
   */
  #keep(kept: Kept): void {
    const { frame } = kept;
    // A frame id at or below kept ones (a report of a flashback that was ignored) makes those stale, but for a new
    // timeline's first tick on its rewind's target: it comes after the target's own frame, and both stay.
    const lastValid = frame.frameId === this.#rewoundTo ? frame.frameId : frame.frameId - 1;
    this.#snapshots.dropAfter(lastValid);
    while ((this.#frames.at(-1)?.frame.frameId ?? -Infinity) > lastValid) this.#frames.pop();
    this.#frames.push(kept);
    const newest = this.#snapshots.newest;
    const due = this.#state.sessionTime >= newest.sessionTime + SNAPSHOT_EVERY_MS || frame.frameId >= newest.frameId + this.#snapshotEveryFrames;
    if (!due) return;
    this.#snapshots.take(this.#state, frame.frameId, kept.attached);
    const start = this.#snapshots.windowStart.state.frameNumber;
    const firstNeeded = this.#frames.findIndex(({ number }) => number > start);
    this.#frames.splice(0, firstNeeded < 0 ? this.#frames.length : firstNeeded);
  }
}
