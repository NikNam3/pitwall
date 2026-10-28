// Link groups to concrete cars (spec 7.5): "player" and "teammate" become car ids through `session.info`.
import type { CarRef, LinkGroup, SessionInfo } from '@pitwall/contracts';
import type { CarId, FeedId } from '@pitwall/domain';
import type { ResolvedLink } from '../../kit/types.ts';

const carOf = (ref: CarRef, session: SessionInfo): CarId | undefined =>
  ref === 'player' ? session.playerCar : ref === 'teammate' ? session.teammateCar : ref;

/**
 * The link a panel of `group` follows, or undefined while it cannot be resolved: no session yet, or a primary of
 * `'teammate'` without a teammate. A compare car that cannot be resolved is dropped. The group's own feed wins over
 * `defaultFeed`.
 */
export function resolveLink(group: LinkGroup, session: SessionInfo | undefined, defaultFeed: FeedId | undefined): ResolvedLink | undefined {
  const feedId = group.feedId ?? defaultFeed;
  if (feedId === undefined || session === undefined) return undefined;
  const primary = carOf(group.primary, session);
  if (primary === undefined) return undefined;
  const compare = group.compare.flatMap((ref) => carOf(ref, session) ?? []);
  return { group: group.id, feedId, primary, compare, window: group.window };
}

/** True when two links resolve to the same feed, group, cars and time window. */
export const sameLink = (a: ResolvedLink | undefined, b: ResolvedLink | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && JSON.stringify(a) === JSON.stringify(b));
