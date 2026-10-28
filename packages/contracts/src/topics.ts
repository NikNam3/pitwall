// The topic table (spec 8.4). Each topic is one file in `topics/`; `scripts/gen-topics.ts` collects them.
// Everything here is JSON-safe: `sessionUid` is the decimal string, never a `bigint`.
import { TOPICS } from './topics/index.generated.ts';

export { TOPICS };
export type { TopicDef, TopicOwner } from './topic-def.ts';
export type { FeedStatus } from './topics/feed.status.ts';
export type { SessionInfo } from './topics/session.info.ts';
export type { CarOverview } from './topics/cars.overview.ts';
export type { InsightEntry } from './topics/insights.ts';

export type TopicName = keyof typeof TOPICS;
export type TopicParams<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['params']>;
export type TopicValue<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['value']>;
