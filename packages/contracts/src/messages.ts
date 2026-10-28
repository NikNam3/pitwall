// WebSocket messages (spec 8.2). The reserved `command` channel only ever gets `notSupported` in the MVP.
import type { FeedId } from '@pitwall/domain';
import type { ReservedCommand } from './commands.ts';
import type { FeedInfo } from './feeds.ts';
import type { TopicName } from './topics.ts';
import type { UiAction } from './ui/types.ts';

export type TopicStatus = 'ok' | 'errored' | 'noData';
export type ErrorReason = 'malformed' | 'unknownFeed';

export type ClientMessage =
  | { type: 'subscribe'; id: string; topic: TopicName; params: object; feedId?: FeedId }
  | { type: 'unsubscribe'; id: string }
  | { type: 'command'; id: string; command: ReservedCommand }
  | { type: 'uiAction'; id: string; action: UiAction }
  | { type: 'heartbeat' };

export type ServerMessage =
  | { type: 'hello'; contractVersion: number; feeds: FeedInfo[] }
  | { type: 'snapshot'; id: string; value?: unknown; entries?: unknown[] }
  | { type: 'update'; id: string; value: unknown }
  | { type: 'append'; id: string; entries: unknown[] }
  | { type: 'topicStatus'; id: string; status: TopicStatus }
  | { type: 'commandResult'; id: string; ok: false; reason: 'notSupported' }
  | { type: 'actionResult'; id: string; ok: true }
  | { type: 'actionResult'; id: string; ok: false; reason: 'invalid' | 'notSupported' }
  | { type: 'heartbeat' }
  | { type: 'error'; id?: string; reason: ErrorReason };
