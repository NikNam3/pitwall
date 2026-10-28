import type { CarId, FeedId, SessionTime } from './ids.ts';

export type InsightSeverity = 'critical' | 'advisory' | 'info';
export type InsightCategory = 'strategy' | 'tyres' | 'energy' | 'damage' | 'race' | 'feed' | 'system';

/** A condition worth telling the engineer about (spec 8.3); active until `resolvedAt`. The UI formats `params`. */
export type Insight = {
  /** Deduplication: an active key is never raised twice. */
  key: string;
  severity: InsightSeverity;
  category: InsightCategory;
  feedId: FeedId;
  carId?: CarId;
  kind: string;
  params: Record<string, number | string>;
  raisedAt: SessionTime;
  resolvedAt?: SessionTime;
};
