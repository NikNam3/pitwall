// The only module that touches JSON. Swap this file to change the wire format (spec 8.2).
// Decoders take untrusted input: they return `undefined` for anything malformed and never throw.
// Accepted messages are rebuilt from the known fields only, so unknown extras are dropped.
import { VisualCompound, type FeedId } from '@pitwall/domain';
import type { ClientMessage, ErrorReason, ServerMessage, TopicStatus } from './messages.ts';
import type { ReservedCommand } from './commands.ts';
import type { FeedInfo } from './feeds.ts';
import { decodeUiAction } from './ui/decode.ts';
import { TOPICS, type TopicName } from './topics.ts';

type Json = Record<string, unknown>;

const TOPIC_STATUSES: readonly string[] = ['ok', 'errored', 'noData'] satisfies TopicStatus[];
const ERROR_REASONS: readonly string[] = ['malformed', 'unknownFeed'] satisfies ErrorReason[];
const FEED_KINDS: readonly string[] = ['udp', 'replay'] satisfies Array<FeedInfo['kind']>;
const COMPOUNDS: readonly string[] = Object.values(VisualCompound);

export const encodeMessage = (message: ClientMessage | ServerMessage): string => JSON.stringify(message);

export const decodeClientMessage = (text: string): ClientMessage | undefined => {
  const raw = parseObject(text);
  if (raw === undefined) return undefined;
  switch (raw.type) {
    case 'heartbeat':
      return { type: 'heartbeat' };
    case 'unsubscribe':
      return isId(raw.id) ? { type: 'unsubscribe', id: raw.id } : undefined;
    case 'subscribe':
      return decodeSubscribe(raw);
    case 'command':
      return decodeCommand(raw);
    case 'uiAction': {
      const action = isId(raw.id) ? decodeUiAction(raw.action) : undefined;
      return action === undefined ? undefined : { type: 'uiAction', id: raw.id as string, action };
    }
    default:
      return undefined;
  }
};

export const decodeServerMessage = (text: string): ServerMessage | undefined => {
  const raw = parseObject(text);
  if (raw === undefined) return undefined;
  switch (raw.type) {
    case 'heartbeat':
      return { type: 'heartbeat' };
    case 'hello':
      return decodeHello(raw);
    case 'snapshot':
      return decodeSnapshot(raw);
    case 'update':
      return typeof raw.id === 'string' && 'value' in raw ? { type: 'update', id: raw.id, value: raw.value } : undefined;
    case 'append':
      return typeof raw.id === 'string' && Array.isArray(raw.entries)
        ? { type: 'append', id: raw.id, entries: raw.entries }
        : undefined;
    case 'topicStatus':
      return typeof raw.id === 'string' && isOneOf(TOPIC_STATUSES, raw.status)
        ? { type: 'topicStatus', id: raw.id, status: raw.status as TopicStatus }
        : undefined;
    case 'commandResult':
      return typeof raw.id === 'string' && raw.ok === false && raw.reason === 'notSupported'
        ? { type: 'commandResult', id: raw.id, ok: false, reason: 'notSupported' }
        : undefined;
    case 'actionResult':
      return decodeActionResult(raw);
    case 'error':
      return decodeError(raw);
    default:
      return undefined;
  }
};

const decodeSubscribe = (raw: Json): ClientMessage | undefined => {
  if (!isId(raw.id) || !isTopicName(raw.topic) || !isPlainObject(raw.params)) return undefined;
  const message: ClientMessage = { type: 'subscribe', id: raw.id, topic: raw.topic, params: raw.params };
  if (raw.feedId === undefined) return message;
  return typeof raw.feedId === 'string' ? { ...message, feedId: raw.feedId as FeedId } : undefined;
};

const decodeCommand = (raw: Json): ClientMessage | undefined => {
  if (!isId(raw.id)) return undefined;
  const command = decodeReservedCommand(raw.command);
  return command === undefined ? undefined : { type: 'command', id: raw.id, command };
};

const decodeReservedCommand = (raw: unknown): ReservedCommand | undefined => {
  if (!isPlainObject(raw) || raw.kind !== 'boxCall' || !isOneOf(COMPOUNDS, raw.tyre)) return undefined;
  return { kind: 'boxCall', tyre: raw.tyre as VisualCompound };
};

const decodeHello = (raw: Json): ServerMessage | undefined => {
  if (typeof raw.contractVersion !== 'number' || !Array.isArray(raw.feeds)) return undefined;
  const feeds: FeedInfo[] = [];
  for (const item of raw.feeds) {
    const feed = decodeFeedInfo(item);
    if (feed === undefined) return undefined;
    feeds.push(feed);
  }
  return { type: 'hello', contractVersion: raw.contractVersion, feeds };
};

const decodeFeedInfo = (raw: unknown): FeedInfo | undefined => {
  if (!isPlainObject(raw) || typeof raw.feedId !== 'string' || typeof raw.label !== 'string') return undefined;
  if (!isOneOf(FEED_KINDS, raw.kind)) return undefined;
  const feed: FeedInfo = { feedId: raw.feedId as FeedId, kind: raw.kind as FeedInfo['kind'], label: raw.label };
  if (raw.sessionUid === undefined) return feed;
  return typeof raw.sessionUid === 'string' ? { ...feed, sessionUid: raw.sessionUid } : undefined;
};

const decodeSnapshot = (raw: Json): ServerMessage | undefined => {
  if (typeof raw.id !== 'string') return undefined;
  if ('entries' in raw) return Array.isArray(raw.entries) ? { type: 'snapshot', id: raw.id, entries: raw.entries } : undefined;
  return 'value' in raw ? { type: 'snapshot', id: raw.id, value: raw.value } : undefined;
};

const decodeActionResult = (raw: Json): ServerMessage | undefined => {
  if (typeof raw.id !== 'string') return undefined;
  if (raw.ok === true) return { type: 'actionResult', id: raw.id, ok: true };
  return raw.ok === false && (raw.reason === 'invalid' || raw.reason === 'notSupported')
    ? { type: 'actionResult', id: raw.id, ok: false, reason: raw.reason }
    : undefined;
};

const decodeError = (raw: Json): ServerMessage | undefined => {
  if (!isOneOf(ERROR_REASONS, raw.reason)) return undefined;
  const reason = raw.reason as ErrorReason;
  if (raw.id === undefined) return { type: 'error', reason };
  return typeof raw.id === 'string' ? { type: 'error', id: raw.id, reason } : undefined;
};

const parseObject = (text: string): Json | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const isPlainObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTopicName = (value: unknown): value is TopicName => typeof value === 'string' && Object.hasOwn(TOPICS, value);
const isOneOf = (allowed: readonly string[], value: unknown): value is string => typeof value === 'string' && allowed.includes(value);
