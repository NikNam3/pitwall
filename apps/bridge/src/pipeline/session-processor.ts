// One session of a feed: frames → SessionRunner → Scheduler → topics, plus its session file and its storage.
import { sessionUidString, type FeedId, type Insight, type SessionTime, type SessionUid } from '@pitwall/domain';
import {
  driverKeyOf,
  Scheduler,
  SessionRunner,
  type CalculatorRegistry,
  type FeedMetricsView,
  type FlashbackInfo,
  type Frame,
  type InsightChange,
  type StepResult,
  type WeekendContext,
} from '@pitwall/engine';
import type { TopicName } from '@pitwall/contracts';
import { peekHeader, type ParticipantsPacket, type SessionPacket } from '@pitwall/protocol';
import type { Logger } from '../log.ts';
import type { SessionRow } from '../storage/db.ts';
import type { SessionFile } from '../storage/session-files.ts';
import { MAX_DUMPS_PER_SESSION, writeDebugDump } from './debug-dump.ts';
import { sessionRowOf, type SessionStorage } from './session-storage.ts';
import type { TopicPublisher } from './topic-publisher.ts';

/** Frames waiting for the first Participants packet (about 10 s at 60 Hz); then the session starts without a weekend. */
export const MAX_BUFFERED_FRAMES = 600;

export type SessionProcessorOptions = {
  feedId: FeedId;
  sessionUid: bigint;
  session: SessionPacket;
  /** ISO 8601, stored with the session. */
  startedAt: string;
  registry: CalculatorRegistry;
  publisher: TopicPublisher;
  log: Logger;
  /** The feed's health right now, for the calculators that read `feed`. */
  feedView: () => FeedMetricsView;
  storage?: SessionStorage;
  file?: SessionFile;
  dumpsDir?: string;
};

type Running = { runner: SessionRunner; scheduler: Scheduler };

/** The flashback as an info insight that is raised and resolved at once: an entry in the insight log, nothing active. */
const flashbackChanges = (feedId: FeedId, flashback: FlashbackInfo, at: SessionTime): InsightChange[] => {
  const kind = 'session.flashback';
  const params = { targetLap: flashback.targetLap, rewoundS: flashback.rewoundMs / 1000 };
  const insight: Insight = { key: kind, severity: 'info', category: 'race', feedId, kind, params, raisedAt: at };
  return [{ type: 'raised', insight }, { type: 'resolved', key: kind, at }];
};

/**
 * Runs one session (spec 5.4, 7.3). Frames wait until the first Participants packet, which names the player's
 * `DriverKey` and so the weekend context (spec 9.3). An exception on a frame skips that frame; a topic that fails to
 * publish is marked errored while the other topics go out. Either way the failure is logged and, up to
 * `MAX_DUMPS_PER_SESSION` times, the frame is dumped with its place in the session file (spec 10.1).
 */
export class SessionProcessor {
  readonly sessionUid: bigint;
  readonly #uid: SessionUid;
  readonly #o: SessionProcessorOptions;
  #running: Running | undefined;
  #buffered: Frame[] = [];
  #driversStored = false;
  #dumps = 0;
  #lastReceivedAtMs = 0;

  constructor(opts: SessionProcessorOptions) {
    this.#o = opts;
    this.sessionUid = opts.sessionUid;
    this.#uid = sessionUidString(opts.sessionUid);
    opts.storage?.upsertSession(this.#row());
  }

  push(frame: Frame): void {
    if (this.#running !== undefined) {
      // A session started by the buffer cap still stores its drivers, so later sessions find it in the weekend.
      if (frame.participants !== undefined && !this.#driversStored) this.#storeDrivers(frame.participants);
      this.#apply(this.#running, frame);
      return;
    }
    this.#buffered.push(frame);
    if (frame.participants !== undefined) this.#begin(frame.participants, frame.playerCarIndex);
    else if (this.#buffered.length >= MAX_BUFFERED_FRAMES) this.#begin();
  }

  /**
   * Keeps a datagram in the session file when it belongs here: the session's own uid, or uid 0 while it is open.
   * It runs after the datagram's frames, so a dump's position is approximate: the datagram before the one that
   * closed the frame.
   */
  record(receivedAtMs: number, bytes: Uint8Array): void {
    this.#lastReceivedAtMs = receivedAtMs;
    const uid = peekHeader(bytes)?.sessionUid;
    if (uid === this.sessionUid || uid === 0n) this.#o.file?.write(receivedAtMs, bytes);
  }

  /** Runs whatever still waits for Participants, then closes the session file. */
  async end(receivedAtMs: number): Promise<void> {
    if (this.#running === undefined && this.#buffered.length > 0) this.#begin();
    await this.#o.file?.close(receivedAtMs);
  }

  /** Starts the runner, with the weekend context when Participants arrived, and applies the buffered frames. */
  #begin(participants?: ParticipantsPacket, playerCarIndex = 0): void {
    const { feedId, sessionUid, session, registry } = this.#o;
    const weekend = participants && this.#identify(participants, playerCarIndex);
    const scheduler = new Scheduler(registry);
    scheduler.setNeeded(registry.order.map((calc) => calc.id));
    const running = { runner: new SessionRunner({ feedId, sessionUid, session, ...(weekend && { weekend }) }), scheduler };
    this.#running = running;
    const frames = this.#buffered;
    this.#buffered = [];
    for (const frame of frames) this.#apply(running, frame);
  }

  /** Stores the session's drivers and loads the player's earlier sessions of the weekend. */
  #identify(participants: ParticipantsPacket, playerCarIndex: number): WeekendContext | undefined {
    const { session, storage } = this.#o;
    this.#storeDrivers(participants);
    const driverKey = driverKeyOf(participants, playerCarIndex);
    return storage?.weekendContext(String(session.weekendLinkIdentifier), driverKey, this.#uid);
  }

  #storeDrivers(participants: ParticipantsPacket): void {
    this.#driversStored = true;
    this.#o.storage?.upsertSession(this.#row(participants));
  }

  #apply({ runner, scheduler }: Running, frame: Frame): void {
    const { feedId, publisher, storage, log } = this.#o;
    try {
      const result = runner.apply(frame);
      storage?.writeConfirmed(this.#uid, result.state.history, result.delta);
      if (result.flashback) scheduler.reset();
      const scheduled = scheduler.run({ state: result.state, changed: result.changed, delta: result.delta, feed: this.#o.feedView() });
      // Each topic is published on its own: a failing feature binding never holds back the others.
      const unpublished = [
        ...publisher.publishOutputs(scheduled),
        ...publisher.publishHistory(result.state.history, result.delta),
        ...publisher.publishInsights([...this.#flashbackOf(result), ...scheduled.insights]),
      ];
      for (const correction of result.corrections) log.info({ feedId, sessionUid: this.#uid, correction }, 'lap time corrected');
      if (unpublished.length > 0) this.#report(frame, 'topic not published, marked errored', unpublished);
    } catch (error) {
      this.#report(frame, 'frame skipped: processing failed', [{ error }]);
    }
  }

  #flashbackOf(result: StepResult): InsightChange[] {
    return result.flashback ? flashbackChanges(this.#o.feedId, result.flashback, result.state.sessionTime) : [];
  }

  /** Logs every failure of the frame and dumps the frame once, with the first failure. */
  #report(frame: Frame, message: string, failures: ReadonlyArray<{ error: unknown; topic?: TopicName }>): void {
    const { feedId, log } = this.#o;
    for (const { error, topic } of failures) {
      log.error({ feedId, sessionUid: this.#uid, frameId: frame.frameId, ...(topic && { topic }), err: error }, message);
    }
    if (failures[0] !== undefined) this.#dump(frame, failures[0].error);
  }

  #dump(frame: Frame, error: unknown): void {
    const { feedId, log, dumpsDir, file } = this.#o;
    if (dumpsDir === undefined || this.#dumps >= MAX_DUMPS_PER_SESSION) return;
    this.#dumps++;
    try {
      const pwrec = file?.position ?? { t: this.#lastReceivedAtMs };
      const path = writeDebugDump(dumpsDir, { feedId, sessionUid: this.sessionUid, frame, pwrec, error });
      log.info({ feedId, sessionUid: this.#uid, path }, 'debug dump written');
    } catch (dumpError) {
      log.error({ feedId, sessionUid: this.#uid, err: dumpError }, 'debug dump failed');
    }
  }

  #row(participants?: ParticipantsPacket): SessionRow {
    const { session, startedAt, file } = this.#o;
    return sessionRowOf({ sessionUid: this.#uid, session, startedAt, pwrecPath: file?.path ?? null, ...(participants && { participants }) });
  }
}
