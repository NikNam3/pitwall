// Link groups to concrete cars (spec 7.5): "player" and "teammate" become car ids through `session.info`.
import type { CarRef, FeedInfo, LinkGroup, SessionInfo } from '@pitwall/contracts';
import type { CarId, FeedId } from '@pitwall/domain';
import type { ResolvedLink } from '../../kit/types.ts';

/** A feed of the bridge's `hello` with its `session.info`, undefined until the feed has one. */
export type FeedSession = { info: FeedInfo; session: SessionInfo | undefined };

const carOf = (ref: CarRef, session: SessionInfo): CarId | undefined =>
  ref === 'player' ? session.playerCar : ref === 'teammate' ? session.teammateCar : ref;

/**
 * The feed whose player car is the default feed's teammate (SP4.3b spec §10, U12; C1a): another feed of the same
 * session uid and team. Undefined without a teammate, without a known team, or without such a feed.
 */
function teammateFeed(session: SessionInfo, defaultFeed: FeedId, feeds: readonly FeedSession[]): FeedId | undefined {
  const teammate = session.teammateCar;
  const team = feeds.find((f) => f.info.feedId === defaultFeed)?.info.team ?? null;
  if (teammate === undefined || team === null) return undefined;
  return feeds.find(
    (f) => f.info.feedId !== defaultFeed && f.info.team === team && f.session?.sessionUid === session.sessionUid && f.session.playerCar === teammate,
  )?.info.feedId;
}

/**
 * The link a panel of `group` follows, or undefined while it cannot be resolved: no session yet, or a primary of
 * `'teammate'` without a teammate. A compare car that cannot be resolved is dropped. The group's own feed wins over
 * `defaultFeed`; without one, a `'teammate'` primary follows the teammate's own feed when the bridge has it (`feeds`),
 * else the teammate in `defaultFeed`. `session` is the default feed's `session.info`.
 */
export function resolveLink(
  group: LinkGroup,
  session: SessionInfo | undefined,
  defaultFeed: FeedId | undefined,
  feeds: readonly FeedSession[],
): ResolvedLink | undefined {
  if (session === undefined) return undefined;
  const ownFeed = group.feedId === undefined && group.primary === 'teammate' && defaultFeed !== undefined ? teammateFeed(session, defaultFeed, feeds) : undefined;
  const feedId = group.feedId ?? ownFeed ?? defaultFeed;
  if (feedId === undefined) return undefined;
  const primary = carOf(group.primary, session);
  if (primary === undefined) return undefined;
  const compare = group.compare.flatMap((ref) => carOf(ref, session) ?? []);
  return { group: group.id, feedId, primary, compare, window: group.window };
}

/** True when two links resolve to the same feed, group, cars and time window. */
export const sameLink = (a: ResolvedLink | undefined, b: ResolvedLink | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
