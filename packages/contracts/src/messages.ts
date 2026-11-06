// WebSocket messages (spec 8.2). The reserved `command` channel only ever gets `notSupported` in the MVP.
import type { FeedId } from '@pitwall/domain';
import type { ReservedCommand } from './commands.ts';
import type { FeedInfo } from './feeds.ts';
import type { TopicName } from './topics.ts';
import type { UiAction } from './ui/types.ts';

/** A transport action on a replay feed (spec 8.5). */
export type ReplayControl =
  | { kind: 'pause' }
  | { kind: 'play' }
  | { kind: 'speed'; factor: number }
  | { kind: 'jumpToLap'; lap: number }
  | { kind: 'jumpToTime'; sessionTimeMs: number };

export type TopicStatus = 'ok' | 'errored' | 'noData';
export type ErrorReason = 'malformed' | 'unknownFeed';

export type ClientMessage =
  | { type: 'subscribe'; id: string; topic: TopicName; params: object; feedId?: FeedId }
  | { type: 'unsubscribe'; id: string }
  | { type: 'command'; id: string; command: ReservedCommand }
  | { type: 'uiAction'; id: string; action: UiAction }
  | { type: 'replayControl'; id: string; control: ReplayControl }
  | { type: 'heartbeat' };

/**
 * What a uiAction's owner answers: accepted, or rejected with a reason and, for an invalid one, a message (C73).
 * `linkLost` is never sent by the bridge: the UI's connection settles an action with it when the link was not open or
 * closed before the answer; it carries no message (the UI words it, C68).
 */
export type ActionOutcome = { ok: true } | { ok: false; reason: 'invalid' | 'notSupported' | 'linkLost'; message?: string };

/** What a starting bridge is doing before it serves: rebuilding stored sessions (C61), `done` of `total` recordings. */
export type StartupProgress = { step: 'rebuild'; done: number; total: number };

export type ServerMessage =
  /** Sent only by a bridge that is still starting; it sends no `hello` and closes the link before it serves. */
  | ({ type: 'starting' } & StartupProgress)
  | { type: 'hello'; contractVersion: number; feeds: FeedInfo[] }
  | { type: 'snapshot'; id: string; value?: unknown; entries?: unknown[] }
  | { type: 'update'; id: string; value: unknown }
  | { type: 'append'; id: string; entries: unknown[] }
  | { type: 'topicStatus'; id: string; status: TopicStatus }
  | { type: 'commandResult'; id: string; ok: false; reason: 'notSupported' }
  /** A uiAction's answer; `message`: why an invalid action was rejected, for the UI to show (C73). */
  | ({ type: 'actionResult'; id: string } & ActionOutcome)
  | { type: 'heartbeat' }
  | { type: 'error'; id?: string; reason: ErrorReason };
