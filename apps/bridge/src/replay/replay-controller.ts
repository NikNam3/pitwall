import type { ReplayControl, ReplayStatus } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { TopicHub } from '../hub/topic-hub.ts';
import type { PacketSource } from '../input/packet-source.ts';
import { PwrecSource } from '../input/pwrec-source.ts';
import type { FeedPipeline, FeedPosition } from '../pipeline/feed-pipeline.ts';
import { ReplayPacer, type SeekTarget } from './replay-pacer.ts';

export type ReplayControllerOptions = {
  path: string;
  feedId: FeedId;
  /** Builds the pipeline for a source; the controller starts it. Called again for every backward jump. */
  makePipeline: (source: PacketSource) => FeedPipeline;
  hub: TopicHub;
  /** Waits `ms` for the pacer; resolves or rejects once `signal` aborts. Default a real timer. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Play without waiting between records until the first speed control (the default of `pitwall replay` without `--realtime`). */
  unpaced?: boolean;
  /** Called each time the replay reaches the end of the recording. */
  onEnd?: () => void;
};

/**
 * The transport of one replay feed (spec 8.5): pause, play, speed and jumps. A forward jump fast-forwards the running
 * pipeline; a backward jump (or any jump once the recording has ended) resets the feed and replays from the start
 * as fast as possible. Starts playing at speed 1 as soon as it is constructed.
 */
export class ReplayController {
  /** Resolves once stopped; rejects when the recording cannot be read. */
  readonly done: Promise<void>;
  readonly #o: ReplayControllerOptions;
  readonly #pacer: ReplayPacer;
  readonly #done: PromiseWithResolvers<void> = Promise.withResolvers();
  readonly #settled: Array<() => void> = [];
  #pipeline!: FeedPipeline;
  /** Which pipeline's end counts; a restart or stop makes the old one's end irrelevant. */
  #generation = 0;
  #atEnd = false;
  #beyondEnd = false;
  /** The position before a restart, shown until the restarted pipeline has one of its own. */
  #carried: FeedPosition | undefined;
  #restartTarget: SeekTarget | undefined;
  #restarting = false;
  #stopped = false;
  #failure = false;

  constructor(opts: ReplayControllerOptions) {
    this.#o = opts;
    this.#pacer = new ReplayPacer({
      ...(opts.sleep && { sleep: opts.sleep }),
      ...(opts.unpaced && { unpaced: true }),
      position: () => this.#pipeline.position(),
      onRecord: () => this.#publish(),
      onSeekDone: () => {
        // A paused replay sends no further record after landing: without this, the status would stay on the jump.
        this.#publish();
        this.#settle();
      },
    });
    this.done = this.#done.promise;
    this.done.catch(() => {});
    this.#launch();
  }

  /** Where the replay is; undefined before the first frame. During a restart it stays where it was until the new run has a frame. */
  position(): FeedPosition | undefined {
    return this.#pipeline.position() ?? this.#carried;
  }

  /** How the replay plays: paused, the speed factor and whether it runs unpaced (as fast as possible). */
  transport(): { paused: boolean; speed: number; unpaced: boolean } {
    return { paused: this.#pacer.paused, speed: this.#pacer.speed, unpaced: this.#pacer.unpaced };
  }

  /** Applies a transport action. */
  control(control: ReplayControl): void {
    switch (control.kind) {
      case 'pause':
        this.#pacer.setPaused(true);
        break;
      case 'play':
        this.#pacer.setPaused(false);
        break;
      case 'speed':
        this.#pacer.setSpeed(control.factor);
        break;
      case 'jumpToLap':
        this.#jump({ kind: 'lap', lap: control.lap });
        break;
      case 'jumpToTime':
        this.#jump({ kind: 'time', sessionTimeMs: control.sessionTimeMs });
        break;
    }
    this.#publish();
  }

  /** Resolves once no jump is under way (it reached its target or the recording's end). */
  settled(): Promise<void> {
    if (this.#idle) return Promise.resolve();
    return new Promise((resolve) => this.#settled.push(resolve));
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#generation++;
    const stopping = this.#pipeline.stop();
    this.#pacer.wake();
    await stopping;
    this.#done.resolve();
    this.#settle();
  }

  get #idle(): boolean {
    return this.#stopped || this.#failure || this.#atEnd || (!this.#pacer.seeking && !this.#restarting);
  }

  #jump(target: SeekTarget): void {
    this.#beyondEnd = false;
    if (this.#restarting) {
      this.#restartTarget = target;
    } else if (this.#atEnd || this.#isBehind(target)) {
      this.#restart(target);
    } else {
      this.#pacer.seekTo(target);
    }
  }

  /** The target lies at or before where the replay is now, so only a replay from the start gets there. */
  #isBehind(target: SeekTarget): boolean {
    const position = this.position();
    if (position === undefined) return false;
    return target.kind === 'time' ? position.sessionTimeMs >= target.sessionTimeMs : position.playerLap >= target.lap;
  }

  #restart(target: SeekTarget): void {
    this.#restarting = true;
    this.#restartTarget = target;
    this.#generation++;
    this.#pacer.cancelSeek();
    const stopping = this.#pipeline.stop();
    void stopping.then(() => {
      this.#restarting = false;
      if (this.#stopped) return;
      this.#carried = this.#pipeline.position() ?? this.#carried;
      this.#o.hub.resetFeed(this.#o.feedId);
      this.#atEnd = false;
      this.#pacer.seekTo(this.#restartTarget ?? target);
      this.#launch();
      this.#publish();
    });
  }

  #launch(): void {
    const { path, feedId, makePipeline } = this.#o;
    const generation = this.#generation;
    const pipeline = makePipeline(new PwrecSource({ feedId, path, pacer: this.#pacer }));
    this.#pipeline = pipeline;
    pipeline.start();
    pipeline.done.then(
      () => generation === this.#generation && this.#ended(),
      (error: unknown) => generation === this.#generation && this.#failed(error),
    );
    this.#publish();
  }

  /** The recording cannot be read: `done` rejects and nobody keeps waiting for a jump. */
  #failed(error: unknown): void {
    this.#failure = true;
    this.#restarting = false;
    this.#pacer.cancelSeek();
    this.#done.reject(error);
    this.#settle();
  }

  /** The recording ran out; a fast-forward still under way did not reach its target. */
  #ended(): void {
    if (this.#pacer.seeking) {
      this.#beyondEnd = !this.#pacer.reachedTarget();
      this.#pacer.cancelSeek();
    }
    this.#atEnd = true;
    this.#publish();
    this.#settle();
    this.#o.onEnd?.();
  }

  #settle(): void {
    if (!this.#idle) return;
    for (const resolve of this.#settled.splice(0)) resolve();
  }

  /** Nothing is published before the first frame: subscribers see `noData`, not zeros. */
  #publish(): void {
    if (this.position() === undefined) return;
    this.#o.hub.publishState(this.#o.feedId, 'replay.status', () => this.#status());
  }

  /** Where the jump under way goes: the restart's target until the restarted run fast-forwards to it. */
  get #jumpingTo(): SeekTarget | undefined {
    if (this.#stopped || this.#failure) return undefined;
    return this.#restarting ? this.#restartTarget : this.#pacer.seekTarget;
  }

  #status(): ReplayStatus {
    const position = this.position() ?? { sessionTimeMs: 0, playerLap: 0 };
    const jumpingTo = this.#jumpingTo;
    return {
      paused: this.#pacer.paused,
      speed: this.#pacer.speed,
      sessionTimeMs: position.sessionTimeMs,
      playerLap: position.playerLap,
      atEnd: this.#atEnd,
      ...(this.#pacer.unpaced && { unpaced: true as const }),
      ...(jumpingTo !== undefined && { jumpingTo }),
      ...(this.#beyondEnd && { note: 'beyondEnd' as const }),
    };
  }
}
