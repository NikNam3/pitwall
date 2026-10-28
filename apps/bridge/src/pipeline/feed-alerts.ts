// Insights that belong to the feed rather than to a session: feed health, and the bridge failing to write.
import type { FeedId, Insight, SessionTime } from '@pitwall/domain';
import { InsightBook, type FeedMetricsView, type InsightChange } from '@pitwall/engine';
import { feedInsights } from '../features/feed-status/feed-status.ts';

/** What the bridge can fail to write; each failure is one insight while the session lasts. */
export const WRITE_FAILURES = {
  pwrec: { kind: 'system.pwrecWriteFailed', severity: 'critical' },
  storage: { kind: 'system.storageWriteFailed', severity: 'advisory' },
} as const satisfies Record<string, { kind: string; severity: Insight['severity'] }>;

export type WriteFailure = keyof typeof WRITE_FAILURES;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The feed's own insights, as raised/resolved changes for the `insights` topic. */
export class FeedAlerts {
  readonly #feedId: FeedId;
  readonly #book = new InsightBook();
  readonly #failures = new Map<WriteFailure, Insight>();

  constructor(feedId: FeedId) {
    this.#feedId = feedId;
  }

  get active(): Insight[] {
    return this.#book.active;
  }

  /** The feed-health insights that hold for `feed` now (stale, packet loss, wrong format). */
  feedChanged(feed: FeedMetricsView, at: SessionTime): InsightChange[] {
    return this.#book.apply('feed', feedInsights(this.#feedId, feed, at), at);
  }

  writeFailed(failure: WriteFailure, error: unknown, at: SessionTime): InsightChange[] {
    const { kind, severity } = WRITE_FAILURES[failure];
    const insight: Insight = { key: kind, severity, category: 'system', feedId: this.#feedId, kind, params: { message: messageOf(error) }, raisedAt: at };
    this.#failures.set(failure, insight);
    return this.#book.apply('system', [...this.#failures.values()], at);
  }

  /**
   * Test aid for the Playwright specs (`PITWALL_E2E_INSIGHT`): one critical `system` insight with `key` as key and
   * kind, active for the rest of the feed (a new session raises it again with the other active ones).
   */
  raiseTestInsight(key: string, at: SessionTime): InsightChange[] {
    const insight: Insight = { key, severity: 'critical', category: 'system', feedId: this.#feedId, kind: key, params: {}, raisedAt: at };
    return this.#book.apply('test', [insight], at);
  }

  /** A new session opens its writers afresh, so earlier write failures no longer hold; the feed reset drops them from the log. */
  clearWriteFailures(at: SessionTime): void {
    this.#failures.clear();
    this.#book.apply('system', [], at);
  }
}
