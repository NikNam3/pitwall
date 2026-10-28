import type { FeedStatus } from '@pitwall/contracts';
import type { Role } from '../../theme/roles.ts';

const LOSS_WARNING_PERCENT = 5;

/** Critical when the feed is down; warning when stale, lossy (5 % or more) or fed packets of the wrong format. */
export function connectionRole(feed: FeedStatus): Role | undefined {
  if (!feed.connected) return 'critical';
  if (feed.stale || feed.lossPercent >= LOSS_WARNING_PERCENT || (feed.wrongFormat ?? 0) > 0) return 'warning';
  return undefined;
}
