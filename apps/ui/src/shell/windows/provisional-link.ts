// The link a panel follows until the shell reads link groups (spec 7.5): the player's car, live, on the default feed.
import type { PanelSpec, SessionInfo } from '@pitwall/contracts';
import type { FeedId } from '@pitwall/domain';
import type { ResolvedLink } from '../../kit/types.ts';

/** The panel's link, or undefined while there is no feed or no session to name the player's car. */
export function provisionalLink(spec: PanelSpec, feedId: FeedId | undefined, session: SessionInfo | undefined): ResolvedLink | undefined {
  if (feedId === undefined || session === undefined) return undefined;
  return { group: spec.linkGroup, feedId, primary: session.playerCar, compare: [], window: { kind: 'live' } };
}

/** True when two links resolve to the same feed, group, cars and time window. */
export const sameLink = (a: ResolvedLink | undefined, b: ResolvedLink | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
