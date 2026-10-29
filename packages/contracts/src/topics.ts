// The topic table (spec 8.4). Each topic is one file in `topics/`; `scripts/gen-topics.ts` collects them.
// Everything here is JSON-safe: `sessionUid` is the decimal string, never a `bigint`.
import { TOPICS } from './topics/index.generated.ts';

export { TOPICS };
export type { TopicDef, TopicOwner } from './topic-def.ts';
export type { FeedStatus } from './topics/feed.status.ts';
export type { ReplayStatus } from './topics/replay.status.ts';
export type { SessionInfo } from './topics/session.info.ts';
export type { CarOverview } from './topics/cars.overview.ts';
export type { InsightEntry } from './topics/insights.ts';
export type { WorkbooksState } from './topics/ui.workbooks.ts';
export type { AlertsState } from './topics/ui.alerts.ts';
export type { UiSettings } from './topics/ui.settings.ts';
export type { GapperParams } from './topics/gaps.gapper.ts';
export type { LapBoardParams } from './topics/lapTimes.board.ts';

export type TopicName = keyof typeof TOPICS;
export type TopicParams<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['params']>;
export type TopicValue<T extends TopicName> = NonNullable<(typeof TOPICS)[T]['value']>;
